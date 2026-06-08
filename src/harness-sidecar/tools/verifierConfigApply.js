import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadVerifierRegistry } from './verifierRegistry.js';

const SAFE_ID = /^[A-Za-z0-9_.:-]+$/;
const SAFE_COMMAND_PREFIX = /^(npm|node|npx|pnpm|yarn|git)\b/;
const UNSAFE_COMMAND = /(\r|\n|&&|\|\||[;|`<>]|\$\(|\brm\s+-rf\b|\bremove-item\b|\bdel\s+\/[sq]\b|\bformat\b)/i;

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
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

function candidateId(candidate = {}) {
  return candidate.candidateId || candidate.genomeId || candidate.genome?.genomeId || null;
}

function verifierFromCandidate(candidate = {}) {
  const verifier = candidate.verifier || candidate.genome?.verifier;
  if (!verifier || typeof verifier !== 'object') {
    throw new Error('candidate verifier is required');
  }
  return verifier;
}

function assertSafeCommand(command) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Verifier command must be a non-empty string');
  }
  if (!SAFE_COMMAND_PREFIX.test(command.trim()) || UNSAFE_COMMAND.test(command)) {
    throw new Error(`Unsafe verifier command: ${command}`);
  }
}

function assertSafeVerifier({ workspaceRoot, verifier }) {
  if (!verifier.name || !SAFE_ID.test(verifier.name)) {
    throw new Error(`Unsafe verifier name: ${verifier.name || ''}`);
  }

  const hasCommand = typeof verifier.command === 'string' && verifier.command.trim() !== '';
  const hasTool = typeof verifier.tool === 'string' && verifier.tool.trim() !== '';
  if (hasCommand === hasTool) {
    throw new Error(`Verifier "${verifier.name}" must define exactly one of command or tool`);
  }
  if (hasCommand) assertSafeCommand(verifier.command);
  if (hasTool && !SAFE_ID.test(verifier.tool)) {
    throw new Error(`Unsafe verifier tool: ${verifier.tool || ''}`);
  }

  if (verifier.cwd && verifier.cwd !== '.') {
    const resolvedCwd = path.isAbsolute(verifier.cwd)
      ? path.resolve(verifier.cwd)
      : path.resolve(workspaceRoot, verifier.cwd);
    if (!isInsideRoot(workspaceRoot, resolvedCwd)) {
      throw new Error(`Verifier "${verifier.name}" cwd is outside workspace: ${verifier.cwd}`);
    }
  }
}

function normalizeVerifierForWrite({ workspaceRoot, verifier }) {
  assertSafeVerifier({ workspaceRoot, verifier });
  const record = {
    name: verifier.name,
    kind: verifier.kind || 'custom',
    risk: verifier.risk || 'medium',
    timeoutMs: Number.isFinite(verifier.timeoutMs) ? verifier.timeoutMs : 120000,
    appliesTo: normalizeArray(verifier.appliesTo, ['**/*']),
    tags: normalizeArray(verifier.tags),
  };

  if (typeof verifier.command === 'string' && verifier.command.trim()) {
    record.command = verifier.command.trim();
  } else {
    record.tool = verifier.tool.trim();
    const toolInput = normalizeObject(verifier.toolInput);
    if (Object.keys(toolInput).length) record.toolInput = toolInput;
  }

  const rubric = normalizeObject(verifier.rubric);
  if (Object.keys(rubric).length) record.rubric = rubric;
  if (verifier.cwd && verifier.cwd !== '.') record.cwd = verifier.cwd;
  if (Number.isFinite(verifier.maxOutputBytes)) record.maxOutputBytes = verifier.maxOutputBytes;
  return record;
}

async function validateThroughRegistry({ workspaceRoot, config }) {
  const validationRootBase = path.join(workspaceRoot, '.harness', 'verifier-apply-validation-');
  const validationRoot = await mkdtemp(validationRootBase);
  try {
    const validationHarnessDir = path.join(validationRoot, '.harness');
    await mkdir(validationHarnessDir, { recursive: true });
    await writeFile(
      path.join(validationRoot, 'package.json'),
      JSON.stringify({ scripts: {} }),
      'utf8',
    );
    await writeFile(
      path.join(validationHarnessDir, 'verifiers.json'),
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8',
    );
    await loadVerifierRegistry({ workspaceRoot: validationRoot });
  } finally {
    await rm(validationRoot, { recursive: true, force: true });
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function applyVerifierConfigCandidate({
  workspaceRoot,
  candidate,
  approval,
  currentRegistry,
} = {}) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  if (!approval?.approved) {
    return {
      status: 'rejected',
      reason: 'approval_required',
      candidateId: candidateId(candidate),
    };
  }

  const harnessDir = path.join(resolvedWorkspaceRoot, '.harness');
  if (!isInsideRoot(resolvedWorkspaceRoot, harnessDir)) {
    throw new Error('Harness directory must be inside workspace');
  }
  await mkdir(harnessDir, { recursive: true });

  const verifiersPath = path.join(harnessDir, 'verifiers.json');
  const existingConfig = await readJsonIfExists(verifiersPath, {
    version: currentRegistry?.version || 1,
    verifiers: [],
  });
  const verifier = normalizeVerifierForWrite({
    workspaceRoot: resolvedWorkspaceRoot,
    verifier: verifierFromCandidate(candidate),
  });

  const existingVerifiers = Array.isArray(existingConfig.verifiers) ? existingConfig.verifiers : [];
  const withoutCandidate = existingVerifiers.filter((record) => record?.name !== verifier.name);
  const nextConfig = {
    version: Number(existingConfig.version) || currentRegistry?.version || 1,
    verifiers: [...withoutCandidate, verifier],
  };

  await validateThroughRegistry({ workspaceRoot: resolvedWorkspaceRoot, config: nextConfig });

  const backupPath = path.join(harnessDir, `verifiers.backup.${timestamp()}.json`);
  if (!isInsideRoot(harnessDir, backupPath) || !isInsideRoot(harnessDir, verifiersPath)) {
    throw new Error('Verifier config writes must stay under workspace .harness');
  }

  await writeFile(backupPath, `${JSON.stringify(existingConfig, null, 2)}\n`, 'utf8');
  await writeFile(verifiersPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');

  return {
    status: 'applied',
    candidateId: candidateId(candidate),
    verifier: verifier.name,
    path: verifiersPath,
    backupPath,
    approvedBy: approval.approvedBy || null,
  };
}
