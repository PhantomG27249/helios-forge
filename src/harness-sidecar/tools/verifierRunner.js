import { runShellCommand } from './shellBroker.js';

export async function runVerifiers({
  workspaceRoot,
  taskId,
  verifiers = [],
  emitEvent = () => {},
  maxOutputBytes,
}) {
  const results = [];

  for (const verifier of verifiers) {
    await emitEvent({
      type: 'verifier.started',
      taskId,
      verifier: verifier.name,
      command: verifier.command,
    });

    const shellResult = await runShellCommand({
      command: verifier.command,
      cwd: verifier.cwd || workspaceRoot,
      workspaceRoot,
      timeoutMs: verifier.timeoutMs || 60000,
      maxOutputBytes: verifier.maxOutputBytes || maxOutputBytes,
    });

    await emitEvent({
      type: 'verifier.output',
      taskId,
      verifier: verifier.name,
      stdout: shellResult.stdout,
      stderr: shellResult.stderr,
      exitCode: shellResult.exitCode,
      timedOut: shellResult.timedOut,
    });

    const passed = shellResult.exitCode === 0 && !shellResult.timedOut;
    const result = {
      name: verifier.name,
      command: verifier.command,
      passed,
      ...shellResult,
    };
    results.push(result);

    await emitEvent({
      type: 'verifier.finished',
      taskId,
      verifier: verifier.name,
      result: passed ? 'passed' : 'failed',
      exitCode: shellResult.exitCode,
      timedOut: shellResult.timedOut,
      durationMs: shellResult.durationMs,
    });
  }

  await emitEvent({
    type: 'verifier.run_completed',
    taskId,
    verifierCount: results.length,
    passedCount: results.filter((result) => result.passed).length,
    failedCount: results.filter((result) => !result.passed).length,
  });

  return results;
}
