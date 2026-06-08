function inferPatchStats(patch = '') {
  const changedLines = patch
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---'))
    .length;
  return { changedLines };
}

function normalizeText(value) {
  return typeof value === 'string' ? value : '';
}

export async function runCommandAttempt({
  attempt = {},
  worktreePath,
  command,
  verifierCommand,
  commandAdapter,
  verifierAdapter,
  timeoutMs,
} = {}) {
  if (typeof commandAdapter !== 'function') {
    throw new Error('commandAdapter is required');
  }
  if (!worktreePath) {
    throw new Error('worktreePath is required');
  }

  const commandResult = await commandAdapter({
    attempt,
    command,
    cwd: worktreePath,
    timeoutMs,
  });

  const stdout = normalizeText(commandResult?.stdout);
  const stderr = normalizeText(commandResult?.stderr);
  const exitCode = Number.isFinite(commandResult?.exitCode) ? commandResult.exitCode : 1;
  const patch = normalizeText(commandResult?.patch) || stdout;
  const verifierEvidence = [
    {
      command,
      cwd: worktreePath,
      exitCode,
      stdout,
      stderr,
      durationMs: commandResult?.durationMs,
    },
  ];
  const adapterEvidence = Array.isArray(commandResult?.verifierEvidence)
    ? commandResult.verifierEvidence
    : [];
  verifierEvidence.push(...adapterEvidence);

  let verifierExitCode = null;
  if (typeof verifierAdapter === 'function') {
    const verifierResult = await verifierAdapter({
      attempt,
      command: verifierCommand,
      cwd: worktreePath,
      timeoutMs,
    });
    verifierExitCode = Number.isFinite(verifierResult?.exitCode) ? verifierResult.exitCode : 1;
    verifierEvidence.push({
      command: verifierCommand,
      cwd: worktreePath,
      exitCode: verifierExitCode,
      stdout: normalizeText(verifierResult?.stdout),
      stderr: normalizeText(verifierResult?.stderr),
      durationMs: verifierResult?.durationMs,
    });
  }

  const passed = exitCode === 0 && (verifierExitCode === null || verifierExitCode === 0);

  return {
    attemptId: attempt.attemptId,
    strategy: attempt.strategy,
    patch,
    verifierEvidence,
    passed,
    score: Number.isFinite(commandResult?.score) ? commandResult.score : (passed ? 100 : 0),
    patchStats: commandResult?.patchStats || inferPatchStats(patch),
    command: {
      text: command,
      cwd: worktreePath,
      exitCode,
      stderr,
      stdout,
      durationMs: commandResult?.durationMs,
    },
  };
}
