import { scheduleAttempts } from './attemptScheduler.js';
import { chooseChampion } from './championSelector.js';
import { recombineApprovedOutputs } from './recombiner.js';
import { reviewAttempt } from './reviewer.js';
import { runSubagentAttempt } from './subagentRunner.js';

function buildRiskPolicy(context = {}, riskPolicy = {}) {
  return {
    ...riskPolicy,
    forbiddenPaths: riskPolicy.forbiddenPaths || context.forbiddenFiles || [],
  };
}

export async function orchestrateSwarm({
  task = {},
  taskType = 'general',
  maxAttempts = 4,
  context = {},
  budget = {},
  outputContract = { requiredFields: ['patch', 'verifierEvidence'] },
  commandAdapter,
  runMode,
  riskPolicy = {},
  onAttemptEvent,
} = {}) {
  const taskId = task.taskId || 'task_swarm';
  const mode = runMode || (commandAdapter ? 'real' : 'dry-run');
  const scheduledAttempts = scheduleAttempts({ taskId, taskType, maxAttempts });
  const attempts = [];

  for (const scheduledAttempt of scheduledAttempts) {
    await onAttemptEvent?.({
      type: 'swarm.subagent_started',
      taskId,
      attemptId: scheduledAttempt.attemptId,
      role: 'implementer',
      strategy: scheduledAttempt.strategy,
      status: 'running',
      summary: `${scheduledAttempt.attemptId} running ${scheduledAttempt.strategy}`,
    });

    const runnerResult = await runSubagentAttempt({
      task: { ...task, taskId },
      attempt: scheduledAttempt,
      role: 'implementer',
      context,
      budget,
      outputContract,
      commandAdapter,
    });
    const verifierEvidence = runnerResult.verifierEvidence || [];

    attempts.push({
      ...scheduledAttempt,
      ...runnerResult,
      verifierPassed: verifierEvidence.length > 0,
      verifierEvidence,
      patchStats: runnerResult.patchStats,
      score: runnerResult.score || 0,
    });

    const attemptRecord = attempts[attempts.length - 1];
    await onAttemptEvent?.({
      type: 'swarm.subagent_completed',
      taskId,
      attemptId: attemptRecord.attemptId,
      role: attemptRecord.role,
      strategy: attemptRecord.strategy,
      status: attemptRecord.status,
      summary: attemptRecord.output?.summary || `${attemptRecord.attemptId} ${attemptRecord.status}`,
      score: attemptRecord.score,
      verifierPassed: attemptRecord.verifierPassed,
      patchStats: attemptRecord.patchStats,
      startedAt: attemptRecord.startedAt,
      completedAt: attemptRecord.completedAt,
    });
  }

  const reviews = attempts.map((attempt) => reviewAttempt({
    attempt,
    riskPolicy: buildRiskPolicy(context, riskPolicy),
  }));
  const recombination = recombineApprovedOutputs({ taskId, reviews });
  const champion = chooseChampion(attempts);

  return {
    taskId,
    runMode: {
      mode,
      dryRun: mode === 'dry-run',
      real: mode === 'real',
    },
    attempts,
    reviews,
    recombination,
    champion,
  };
}
