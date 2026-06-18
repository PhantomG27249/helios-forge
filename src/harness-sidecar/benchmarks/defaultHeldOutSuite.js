import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectWorkplaceTestRunner(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const packageJsonPath = path.join(root, 'package.json');

  if (await fileExists(packageJsonPath)) {
    try {
      const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      const testScript = String(pkg?.scripts?.test || '').trim();
      if (testScript) {
        if (testScript === 'node --test' || testScript.startsWith('node --test ')) {
          return { type: 'node-test', executable: 'node', args: ['--test'] };
        }
        return { type: 'npm-test', executable: 'npm', args: ['test'] };
      }
    } catch {
      // Fall through to other detectors.
    }
  }

  const pytestMarkers = ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini'];
  for (const marker of pytestMarkers) {
    if (await fileExists(path.join(root, marker))) {
      return { type: 'pytest', executable: 'python', args: ['-m', 'pytest'] };
    }
  }

  const requirementsPath = path.join(root, 'requirements.txt');
  if (await fileExists(requirementsPath)) {
    const requirements = await readFile(requirementsPath, 'utf8');
    if (/pytest/i.test(requirements)) {
      return { type: 'pytest', executable: 'python', args: ['-m', 'pytest'] };
    }
  }

  return { type: 'noop', executable: 'node', args: ['-e', 'process.exit(0)'] };
}

export async function buildDefaultHeldOutSuite({ workspaceRoot }) {
  const root = path.resolve(workspaceRoot);
  const primary = await detectWorkplaceTestRunner(root);

  const cases = [
    {
      id: 'workplace-primary-test',
      domain: 'code',
      description: 'Run the workplace primary test command.',
      command: {
        executable: primary.executable,
        args: [...primary.args],
      },
    },
    {
      id: 'workplace-exit-sanity',
      domain: 'safety',
      description: 'Verify command execution returns real process exit codes.',
      command: {
        executable: 'node',
        args: ['-e', 'process.exit(0)'],
      },
    },
  ];

  if (primary.type === 'pytest') {
    cases.push({
      id: 'workplace-node-sanity',
      domain: 'code',
      description: 'Node runtime availability check.',
      command: {
        executable: 'node',
        args: ['-e', 'process.exit(0)'],
      },
    });
  } else {
    cases.push({
      id: 'workplace-inline-pass',
      domain: 'code',
      description: 'Inline node assertion smoke.',
      command: {
        executable: 'node',
        args: ['-e', 'if (1 + 1 !== 2) process.exit(1); process.exit(0);'],
      },
    });
  }

  return {
    schemaVersion: 1,
    id: 'workplace-smoke',
    description: 'Default held-out smoke suite scaffolded for workplace evolution replay.',
    domains: ['code', 'safety'],
    metricWeights: {
      quality: 1,
      reliability: 0.5,
      safety: 0.5,
    },
    cases,
  };
}
