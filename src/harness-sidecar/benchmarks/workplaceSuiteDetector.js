import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const PLACEHOLDER_ADVISORY = Object.freeze({ reason: 'placeholder_suite' });

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function parseShellCommand(commandLine) {
  const trimmed = String(commandLine || '').trim();
  if (!trimmed) {
    throw new Error('command line is required');
  }

  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const normalized = tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));
  if (normalized.length === 0) {
    throw new Error('command line is required');
  }

  return {
    executable: normalized[0],
    args: normalized.slice(1),
  };
}

function runnerFromCommand(type, commandLine, source) {
  const { executable, args } = parseShellCommand(commandLine);
  return {
    type,
    executable,
    args,
    source,
  };
}

function readMetadataPrimaryTestCommand(workplaceMetadata = {}) {
  const benchmarks = workplaceMetadata?.benchmarks;
  const fromBenchmarks = benchmarks?.primaryTestCommand || benchmarks?.testCommand;
  if (fromBenchmarks) {
    return String(fromBenchmarks).trim();
  }
  if (workplaceMetadata?.primaryTestCommand) {
    return String(workplaceMetadata.primaryTestCommand).trim();
  }
  return '';
}

function extractQuotedTomlValue(line) {
  const match = line.match(/=\s*["']([^"']+)["']/);
  return match ? match[1].trim() : '';
}

async function detectPyprojectTestScript(root) {
  const pyprojectPath = path.join(root, 'pyproject.toml');
  if (!(await fileExists(pyprojectPath))) {
    return null;
  }

  const text = await readFile(pyprojectPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const scriptSections = new Set([
    '[tool.hatch.envs.default.scripts]',
    '[tool.pdm.scripts]',
    '[tool.poetry.scripts]',
  ]);
  let inScriptSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inScriptSection = scriptSections.has(line);
      continue;
    }
    if (!inScriptSection || !line.startsWith('test')) {
      continue;
    }

    const command = extractQuotedTomlValue(line);
    if (!command) {
      continue;
    }

    if (command === 'pytest' || command.startsWith('pytest ')) {
      return runnerFromCommand('pyproject-script', command, 'pyproject.toml');
    }
    return runnerFromCommand('pyproject-script', command, 'pyproject.toml');
  }

  if (/\[tool\.pytest\.ini_options\]/m.test(text)) {
    return {
      type: 'pytest',
      executable: 'python',
      args: ['-m', 'pytest'],
      source: 'pyproject.toml',
    };
  }

  return null;
}

async function detectPackageJsonTestScript(root) {
  const packageJsonPath = path.join(root, 'package.json');
  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    const testScript = String(pkg?.scripts?.test || '').trim();
    if (!testScript) {
      return null;
    }

    if (testScript === 'node --test' || testScript.startsWith('node --test ')) {
      return runnerFromCommand('node-test', testScript, 'package.json');
    }

    return {
      type: 'npm-test',
      executable: 'npm',
      args: ['test'],
      source: 'package.json',
    };
  } catch {
    return null;
  }
}

async function detectPytestMarkers(root) {
  const pytestMarkers = ['pytest.ini', 'setup.cfg', 'tox.ini'];
  for (const marker of pytestMarkers) {
    if (await fileExists(path.join(root, marker))) {
      return {
        type: 'pytest',
        executable: 'python',
        args: ['-m', 'pytest'],
        source: marker,
      };
    }
  }

  const requirementsPath = path.join(root, 'requirements.txt');
  if (await fileExists(requirementsPath)) {
    const requirements = await readFile(requirementsPath, 'utf8');
    if (/pytest/i.test(requirements)) {
      return {
        type: 'pytest',
        executable: 'python',
        args: ['-m', 'pytest'],
        source: 'requirements.txt',
      };
    }
  }

  return null;
}

export async function detectWorkplaceTestRunner(workspaceRoot, workplaceMetadata = {}) {
  const root = path.resolve(workspaceRoot);
  const metadataCommand = readMetadataPrimaryTestCommand(workplaceMetadata);
  if (metadataCommand) {
    return {
      ...runnerFromCommand('metadata', metadataCommand, 'workplace-metadata'),
      advisory: null,
    };
  }

  const packageJsonRunner = await detectPackageJsonTestScript(root);
  if (packageJsonRunner) {
    return { ...packageJsonRunner, advisory: null };
  }

  const pyprojectRunner = await detectPyprojectTestScript(root);
  if (pyprojectRunner) {
    return { ...pyprojectRunner, advisory: null };
  }

  const pytestRunner = await detectPytestMarkers(root);
  if (pytestRunner) {
    return { ...pytestRunner, advisory: null };
  }

  return {
    type: 'noop',
    executable: 'node',
    args: ['-e', 'process.exit(0)'],
    source: 'placeholder',
    advisory: { ...PLACEHOLDER_ADVISORY },
  };
}
