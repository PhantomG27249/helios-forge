import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 120000;

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function parseSimpleVerifierYaml(source) {
  const result = { version: 1, verifiers: [] };
  const lines = source.split(/\r?\n/);
  let current = null;
  let activeListKey = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const topLevel = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (topLevel && !line.startsWith(' ')) {
      activeListKey = null;
      if (topLevel[1] === 'version') {
        result.version = Number(topLevel[2]) || 1;
      }
      continue;
    }

    const item = line.match(/^\s*-\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (item) {
      current = { [item[1]]: parseScalar(item[2]) };
      result.verifiers.push(current);
      activeListKey = null;
      continue;
    }

    if (!current) continue;
    const property = line.match(/^\s{4}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (property) {
      const [, key, rawValue] = property;
      if (rawValue === '') {
        current[key] = [];
        activeListKey = key;
      } else {
        current[key] = parseScalar(rawValue);
        activeListKey = null;
      }
      continue;
    }

    const listValue = line.match(/^\s{6}-\s+(.*)$/);
    if (listValue && activeListKey) {
      current[activeListKey].push(parseScalar(listValue[1]));
    }
  }

  return result;
}

async function readYamlIfExists(filePath) {
  try {
    return parseSimpleVerifierYaml(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function normalizeArray(value, fallback = []) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim());
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return fallback;
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function normalizeCwd({ workspaceRoot, verifier }) {
  if (!verifier.cwd || verifier.cwd === '.') return null;
  if (path.isAbsolute(verifier.cwd)) {
    if (!isInsideRoot(workspaceRoot, verifier.cwd)) {
      throw new Error(`Verifier "${verifier.name}" cwd is outside workspace: ${verifier.cwd}`);
    }
    return path.resolve(verifier.cwd);
  }
  const resolved = path.resolve(workspaceRoot, verifier.cwd);
  if (!isInsideRoot(workspaceRoot, resolved)) {
    throw new Error(`Verifier "${verifier.name}" cwd is outside workspace: ${verifier.cwd}`);
  }
  return resolved;
}

function normalizeVerifier({ workspaceRoot, verifier, index }) {
  if (!verifier || typeof verifier !== 'object') {
    throw new Error(`Verifier record at index ${index} must be an object`);
  }
  if (!verifier.name || !/^[A-Za-z0-9_.:-]+$/.test(verifier.name)) {
    throw new Error(`Verifier record at index ${index} has invalid name`);
  }
  const hasCommand = typeof verifier.command === 'string' && verifier.command.trim() !== '';
  const hasTool = typeof verifier.tool === 'string' && verifier.tool.trim() !== '';
  if (hasCommand === hasTool) {
    throw new Error(`Verifier "${verifier.name}" must define exactly one of command or tool`);
  }
  if (hasTool && !/^[A-Za-z0-9_.:-]+$/.test(verifier.tool)) {
    throw new Error(`Verifier "${verifier.name}" has invalid tool name`);
  }

  return {
    name: verifier.name,
    command: hasCommand ? verifier.command : null,
    tool: hasTool ? verifier.tool : null,
    toolInput: normalizeObject(verifier.toolInput),
    rubric: normalizeObject(verifier.rubric),
    kind: verifier.kind || 'custom',
    risk: verifier.risk || 'medium',
    timeoutMs: Number.isFinite(verifier.timeoutMs) ? verifier.timeoutMs : DEFAULT_TIMEOUT_MS,
    cwd: normalizeCwd({ workspaceRoot, verifier }),
    appliesTo: normalizeArray(verifier.appliesTo, ['**/*']),
    tags: normalizeArray(verifier.tags),
    maxOutputBytes: verifier.maxOutputBytes,
  };
}

async function createDefaultVerifiers(workspaceRoot) {
  const packageJson = await readJsonIfExists(path.join(workspaceRoot, 'package.json'));
  const scripts = packageJson?.scripts || {};
  const verifiers = [];

  if (scripts.test) {
    verifiers.push({
      name: 'unit',
      command: 'npm test',
      kind: 'unit',
      risk: 'medium',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cwd: null,
      appliesTo: ['**/*.js', 'package.json'],
      tags: ['default'],
    });
  }
  if (scripts['release:smoke']) {
    verifiers.push({
      name: 'release-smoke',
      command: 'npm run release:smoke',
      kind: 'smoke',
      risk: 'medium',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      cwd: null,
      appliesTo: ['package.json', 'package-lock.json', 'src/**/*.js', 'public/**/*.html'],
      tags: ['default', 'smoke'],
    });
  }

  return verifiers;
}

function buildByName(verifiers) {
  return verifiers.reduce((byName, verifier) => {
    byName[verifier.name] = verifier;
    return byName;
  }, {});
}

export async function loadVerifierRegistry({ workspaceRoot }) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const harnessDir = path.join(resolvedWorkspaceRoot, '.harness');
  const config = await readJsonIfExists(path.join(harnessDir, 'verifiers.json'))
    || await readYamlIfExists(path.join(harnessDir, 'verifiers.yaml'))
    || await readYamlIfExists(path.join(harnessDir, 'verifiers.yml'));
  const defaultVerifiers = await createDefaultVerifiers(resolvedWorkspaceRoot);
  const configuredVerifiers = (config?.verifiers || []).map((verifier, index) => normalizeVerifier({
    workspaceRoot: resolvedWorkspaceRoot,
    verifier,
    index,
  }));
  const byName = buildByName([...defaultVerifiers, ...configuredVerifiers]);
  const verifiers = Object.values(byName);

  return {
    version: Number(config?.version) || 1,
    verifiers,
    byName,
  };
}
