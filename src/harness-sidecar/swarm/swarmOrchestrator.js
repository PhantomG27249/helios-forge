import { scheduleAttempts } from './attemptScheduler.js';
import { chooseChampion } from './championSelector.js';
import { runModelDrivenAttempt } from './modelDrivenWorker.js';
import { recombineApprovedOutputs } from './recombiner.js';
import { reviewAttempt } from './reviewer.js';
import { runSubagentAttempt } from './subagentRunner.js';

function buildRiskPolicy(context = {}, riskPolicy = {}) {
  return {
    ...riskPolicy,
    forbiddenPaths: riskPolicy.forbiddenPaths || context.forbiddenFiles || [],
  };
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function inferPatchStats(output = {}) {
  if (output.patchStats) return output.patchStats;
  if (typeof output.patch !== 'string') return { changedLines: 0 };
  const changedLines = output.patch
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---'))
    .length;
  return { changedLines };
}

function modelWorkerProvider({ modelGateway, modelProvider, modelExecutor, provider }) {
  for (const candidate of [modelExecutor, modelProvider, provider, modelGateway]) {
    if (typeof candidate === 'function' || typeof candidate?.call === 'function') {
      return candidate;
    }
  }
  return null;
}

function modelWorkerRequestId({ taskId, attemptId }) {
  return `${taskId}:${attemptId}:model_worker`;
}

function outputFromModelWorker(result = {}) {
  return {
    summary: result.summary,
    patch: result.patch,
    verifierEvidence: result.verifierEvidence,
    verifierCommands: result.verifierCommands,
    score: result.score,
    artifacts: result.artifacts,
    risks: result.risks,
  };
}

function failureAttemptRecord({
  scheduledAttempt,
  role,
  outputContract,
  worker,
  error,
  startedAt,
}) {
  return {
    ...scheduledAttempt,
    role,
    status: 'failed',
    output: null,
    verifierPassed: false,
    verifierEvidence: [],
    score: 0,
    patchStats: { changedLines: 0 },
    worker,
    contract: {
      requiredFields: outputContract.requiredFields || [],
      missingFields: outputContract.requiredFields || [],
      valid: false,
    },
    failure: {
      reason: worker.kind === 'model_driven' ? 'model_worker_failed' : 'subagent_failed',
      message: error.message,
      retryable: true,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

async function runScheduledAttempt({
  task,
  scheduledAttempt,
  role,
  context,
  budget,
  outputContract,
  commandAdapter,
  modelGateway,
  modelProvider,
  modelExecutor,
  provider,
  modelProfileName,
}) {
  const taskId = task.taskId;
  const injectedModelWorker = modelWorkerProvider({
    modelGateway,
    modelProvider,
    modelExecutor,
    provider,
  });

  if (injectedModelWorker) {
    const requestId = modelWorkerRequestId({ taskId, attemptId: scheduledAttempt.attemptId });
    const worker = {
      kind: 'model_driven',
      requestId,
      profileName: modelProfileName || 'critic_low_temp',
    };
    const startedAt = new Date().toISOString();

    try {
      const modelResult = await runModelDrivenAttempt({
        task,
        attempt: scheduledAttempt,
        role,
        context,
        budget,
        profileName: worker.profileName,
        modelGateway,
        provider: modelExecutor || modelProvider || provider,
        requestId,
      });
      const output = outputFromModelWorker(modelResult);
      const verifierEvidence = asArray(modelResult.verifierEvidence);

      return {
        ...scheduledAttempt,
        attemptId: modelResult.attemptId,
        role: modelResult.role,
        strategy: modelResult.strategy,
        status: modelResult.status,
        output,
        verifierPassed: verifierEvidence.length > 0,
        verifierEvidence,
        score: modelResult.score || 0,
        patchStats: inferPatchStats(output),
        worker,
        model: modelResult.model,
        contract: {
          requiredFields: outputContract.requiredFields || [],
          missingFields: [],
          valid: true,
        },
        startedAt,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return failureAttemptRecord({
        scheduledAttempt,
        role,
        outputContract,
        worker,
        error,
        startedAt,
      });
    }
  }

  const runnerResult = await runSubagentAttempt({
    task,
    attempt: scheduledAttempt,
    role,
    context,
    budget,
    outputContract,
    commandAdapter,
  });
  const verifierEvidence = runnerResult.verifierEvidence || [];
  const worker = {
    kind: commandAdapter ? 'command_subagent' : 'deterministic_subagent',
  };

  return {
    ...scheduledAttempt,
    ...runnerResult,
    worker,
    verifierPassed: verifierEvidence.length > 0,
    verifierEvidence,
    patchStats: runnerResult.patchStats,
    score: runnerResult.score || 0,
    failure: runnerResult.status === 'failed'
      ? {
        reason: 'subagent_failed',
        message: runnerResult.error,
        retryable: true,
      }
      : undefined,
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
  modelGateway,
  modelProvider,
  modelExecutor,
  provider,
  modelProfileName,
  planner,
  runMode,
  riskPolicy = {},
  onAttemptEvent,
} = {}) {
  const taskId = task.taskId || 'task_swarm';
  const hasModelWorker = Boolean(modelWorkerProvider({
    modelGateway,
    modelProvider,
    modelExecutor,
    provider,
  }));
  const mode = runMode || (hasModelWorker ? 'model-driven' : (commandAdapter ? 'real' : 'dry-run'));
  const scheduledAttempts = scheduleAttempts({ taskId, taskType, maxAttempts, planner });
  const attempts = [];

  for (const scheduledAttempt of scheduledAttempts) {
    const requestId = hasModelWorker
      ? modelWorkerRequestId({ taskId, attemptId: scheduledAttempt.attemptId })
      : null;

    await onAttemptEvent?.({
      type: 'swarm.subagent_started',
      taskId,
      attemptId: scheduledAttempt.attemptId,
      role: 'implementer',
      strategy: scheduledAttempt.strategy,
      planning: scheduledAttempt.planning,
      worker: {
        kind: hasModelWorker ? 'model_driven' : (commandAdapter ? 'command_subagent' : 'deterministic_subagent'),
        requestId,
      },
      model: hasModelWorker ? { requestId, profileName: modelProfileName || 'critic_low_temp' } : undefined,
      status: 'running',
      summary: `${scheduledAttempt.attemptId} running ${scheduledAttempt.strategy}`,
    });

    const attemptRecord = await runScheduledAttempt({
      task: { ...task, taskId },
      scheduledAttempt,
      role: 'implementer',
      context,
      budget,
      outputContract,
      commandAdapter,
      modelGateway,
      modelProvider,
      modelExecutor,
      provider,
      modelProfileName,
    });

    attempts.push(attemptRecord);

    await onAttemptEvent?.({
      type: 'swarm.subagent_completed',
      taskId,
      attemptId: attemptRecord.attemptId,
      role: attemptRecord.role,
      strategy: attemptRecord.strategy,
      planning: attemptRecord.planning,
      worker: attemptRecord.worker,
      model: attemptRecord.model,
      status: attemptRecord.status,
      summary: attemptRecord.output?.summary || `${attemptRecord.attemptId} ${attemptRecord.status}`,
      score: attemptRecord.score,
      verifierPassed: attemptRecord.verifierPassed,
      patchStats: attemptRecord.patchStats,
      failure: attemptRecord.failure,
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
    planning: {
      strategy: planner?.enabled ? planner.strategy : 'seeded',
      attempts: scheduledAttempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        strategy: attempt.strategy,
        planning: attempt.planning,
      })),
    },
  };
}
