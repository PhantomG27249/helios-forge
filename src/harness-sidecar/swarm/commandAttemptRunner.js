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
  commandAdapter,
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

  return {
    attemptId: attempt.attemptId,
    strategy: attempt.strategy,
    patch,
    verifierEvidence,
    score: Number.isFinite(commandResult?.score) ? commandResult.score : (exitCode === 0 ? 100 : 0),
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
