import { spawn } from 'node:child_process';
import path from 'node:path';

export class HeldOutSuiteRequiredError extends Error {
  constructor(message = 'held-out suite requires at least one case') {
    super(message);
    this.name = 'HeldOutSuiteRequiredError';
  }
}

function exitCodeToQuality(exitCode) {
  return exitCode === 0 ? 1 : 0;
}

function runCaseCommand({ command, workspaceRoot, spawnImpl }) {
  const trimmed = String(command ?? '').trim();
  if (!trimmed) throw new Error('case command is required');

  const cwd = path.resolve(workspaceRoot);
  return new Promise((resolve) => {
    const child = spawnImpl(trimmed, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.on('error', () => {
      resolve(1);
    });

    child.on('close', (exitCode) => {
      resolve(Number.isFinite(exitCode) ? exitCode : 1);
    });
  });
}

function createCommandRunner({ workspaceRoot, spawnImpl }) {
  return async ({ case: replayCase }) => {
    const exitCode = await runCaseCommand({
      command: replayCase?.command,
      workspaceRoot,
      spawnImpl,
    });
    const quality = exitCodeToQuality(exitCode);
    return {
      passed: exitCode === 0,
      metrics: { quality },
    };
  };
}

export function createTaskReplayRunners({
  workspaceRoot,
  suite,
  syntheticReplay = false,
  spawnImpl = spawn,
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  if (!suite || typeof suite !== 'object') throw new Error('suite is required');

  const cases = Array.isArray(suite.cases) ? suite.cases : [];
  if (cases.length === 0) {
    throw new HeldOutSuiteRequiredError();
  }

  if (syntheticReplay === true) {
    return {
      baselineRunner: async () => ({ metrics: { quality: 0.5 }, passed: true }),
      candidateRunner: async () => ({ metrics: { quality: 0.55 }, passed: true }),
    };
  }

  const runCommand = createCommandRunner({ workspaceRoot, spawnImpl });
  return {
    baselineRunner: runCommand,
    candidateRunner: runCommand,
  };
}
