import { runShellCommand } from './shellBroker.js';

export async function runVerifiers({
  workspaceRoot,
  taskId,
  task,
  verifiers = [],
  emitEvent = () => {},
  maxOutputBytes,
  toolRegistry,
  defaultToolInput = {},
}) {
  const results = [];

  for (const verifier of verifiers) {
    await emitEvent({
      type: 'verifier.started',
      taskId,
      verifier: verifier.name,
      command: verifier.command,
      tool: verifier.tool,
    });

    if (verifier.tool) {
      if (!toolRegistry || typeof toolRegistry.execute !== 'function') {
        throw new Error(`Tool registry is required for verifier "${verifier.name}"`);
      }
      const startedAt = Date.now();
      const toolResult = await toolRegistry.execute(verifier.tool, {
        ...defaultToolInput,
        ...verifier.toolInput,
        taskId,
        goal: task?.task || task?.goal,
        strictness: verifier.rubric?.strictness,
      });
      const durationMs = Date.now() - startedAt;
      const passed = toolResult?.passed === true;
      const result = {
        name: verifier.name,
        tool: verifier.tool,
        passed,
        score: toolResult?.score,
        confidence: toolResult?.confidence,
        findings: Array.isArray(toolResult?.findings) ? toolResult.findings : [],
        artifacts: Array.isArray(toolResult?.artifacts) ? toolResult.artifacts : [],
        durationMs: Number.isFinite(toolResult?.durationMs) ? toolResult.durationMs : durationMs,
      };
      results.push(result);

      await emitEvent({
        type: 'verifier.finished',
        taskId,
        verifier: verifier.name,
        tool: verifier.tool,
        result: passed ? 'passed' : 'failed',
        score: result.score,
        durationMs: result.durationMs,
      });
      continue;
    }

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
