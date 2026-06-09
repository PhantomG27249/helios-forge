import { recordAdaptiveSearchOutcome } from '../bes/adaptiveSearchScheduler.js';
import { runLocalMetaHarness } from '../meta/localMetaHarness.js';
import { scheduleAttempts } from './attemptScheduler.js';
import { loadDefaultAgentProfiles, selectAgentProfileForAttempt } from './agentProfiles.js';
import { chooseChampion } from './championSelector.js';
import { allocateEvolutionSwarmBudgets } from './evolutionBudgetAllocator.js';
import { runModelDrivenAttempt } from './modelDrivenWorker.js';
import { runPiNativeAttempt } from './piNativeWorker.js';
import { recombineApprovedOutputs } from './recombiner.js';
import { reviewAttempt } from './reviewer.js';
import { runSwarmAttemptsBounded } from './swarmExecutor.js';
import { runSubagentAttempt } from './subagentRunner.js';
import { getDefaultSwarmCells, resolveSwarmCell } from './swarmCellRegistry.js';
import { runWorktreeAttempt } from './worktreeAttemptRunner.js';

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

function featureEnabled(featureFlags = {}, name) {
  return featureFlags?.[name] === true;
}

function resolveAttemptCell({ attempt = {}, role } = {}) {
  const profileRole = attempt.profile?.role || role;
  const direct = resolveSwarmCell(attempt.cellId || profileRole);
  if (direct) return direct;
  return getDefaultSwarmCells().find((cell) => cell.role === profileRole) || { cellId: 'code', role: profileRole || 'implementer' };
}

function candidateMemoryProposals(localMeta = {}) {
  return (localMeta.candidates || [])
    .flatMap((candidate) => asArray(candidate.memoryProposals));
}

function proposalKey(proposal) {
  if (proposal?.factId) return `fact:${proposal.factId}`;
  if (proposal?.passageId) return `passage:${proposal.passageId}`;
  return JSON.stringify(proposal);
}

function attemptMemoryProposals(attempt = {}, localMeta = {}) {
  const explicit = asArray(attempt.evolutionOutput?.memoryProposals);
  const seen = new Set();
  return [...explicit, ...candidateMemoryProposals(localMeta)].filter((proposal) => {
    const key = proposalKey(proposal);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    evolutionOutput: result.evolutionOutput,
  };
}

function firstAdaptiveSearchAction(attempts = []) {
  return attempts.find((attempt) => attempt?.planning?.action?.actionId)?.planning?.action || null;
}

function bestVerifierSignal(attempts = []) {
  const evidence = attempts
    .flatMap((attempt) => asArray(attempt.verifierEvidence))
    .filter(Boolean);
  const passed = evidence.some((item) => item.passed === true) || attempts.some((attempt) => attempt.verifierPassed === true);
  const confidence = evidence.reduce((best, item) => {
    const value = Number(item.confidence);
    return Number.isFinite(value) ? Math.max(best, value) : best;
  }, passed ? 0.7 : 0.35);

  return { passed, confidence };
}

function adaptiveSearchReward({ attempts, champion, budget }) {
  return {
    swarm: {
      championScore: champion?.score ?? Math.max(0, ...attempts.map((attempt) => Number(attempt.score) || 0)),
    },
    verifier: bestVerifierSignal(attempts),
    cost: {
      pressure: budget?.pressure ?? budget?.budgetPressure ?? 0,
    },
  };
}

function adaptiveSearchSchedulerSummary(scheduler) {
  return Object.values(scheduler?.arms || {}).map((arm) => ({
    arm: arm.arm,
    visits: arm.visits,
    lastReward: arm.lastReward,
    meanReward: arm.visits > 0
      ? Math.round((arm.totalReward / arm.visits) * 1000000) / 1000000
      : arm.prior,
  }));
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
  verifierAdapter,
  command,
  verifierCommand,
  timeoutMs,
  workspaceRoot,
  worktreeManager,
  modelGateway,
  modelProvider,
  modelExecutor,
  provider,
  modelProfileName,
  piNativeEnabled = false,
  piWorkerFactory,
  emitAttemptTrace,
}) {
  const taskId = task.taskId;
  const injectedModelWorker = modelWorkerProvider({
    modelGateway,
    modelProvider,
    modelExecutor,
    provider,
  });

  if (piNativeEnabled) {
    return runPiNativeAttempt({
      task: { ...task, taskId },
      attempt: scheduledAttempt,
      role,
      context,
      budget,
      outputContract,
      workspaceRoot,
      piWorkerFactory,
      emitTrace: emitAttemptTrace,
    });
  }

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
        taskOutput: modelResult.taskOutput,
        evolutionOutput: modelResult.evolutionOutput,
        contract: modelResult.contract || {
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

  if (commandAdapter && (workspaceRoot || worktreeManager)) {
    const runnerResult = await runWorktreeAttempt({
      task: { ...task, taskId },
      attempt: scheduledAttempt,
      role,
      workspaceRoot,
      worktreeManager,
      command,
      verifierCommand,
      commandAdapter,
      verifierAdapter,
      timeoutMs,
      outputContract,
    });

    if (runnerResult.status !== 'unavailable') {
      const verifierEvidence = runnerResult.verifierEvidence || [];
      return {
        ...scheduledAttempt,
        ...runnerResult,
        worker: {
          kind: 'worktree_command',
        },
        verifierPassed: runnerResult.passed === true,
        verifierEvidence,
        patchStats: runnerResult.patchStats,
        score: runnerResult.score || 0,
        failure: runnerResult.failure,
      };
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
  verifierAdapter,
  command,
  verifierCommand,
  timeoutMs,
  workspaceRoot,
  worktreeManager,
  modelGateway,
  modelProvider,
  modelExecutor,
  provider,
  modelProfileName,
  piWorkerFactory,
  planner,
  evolutionPlanner,
  evolutionBudget,
  swarmExecution,
  agentProfiles,
  runMode,
  riskPolicy = {},
  onAttemptEvent,
  emitEvent,
  featureFlags = {},
} = {}) {
  const taskId = task.taskId || 'task_swarm';
  const hasModelWorker = Boolean(modelWorkerProvider({
    modelGateway,
    modelProvider,
    modelExecutor,
    provider,
  }));
  const hasWorktreeWorker = Boolean(commandAdapter && (workspaceRoot || worktreeManager));
  const piNativeEnabled = swarmExecution?.piNative === true || runMode === 'pi-native';
  const mode = runMode || (piNativeEnabled ? 'pi-native' : (hasModelWorker ? 'model-driven' : (commandAdapter ? 'real' : 'dry-run')));
  const publishAttemptEvent = async (event) => {
    await onAttemptEvent?.(event);
    if (emitEvent && emitEvent !== onAttemptEvent) {
      await emitEvent(event);
    }
  };
  const profiles = agentProfiles || loadDefaultAgentProfiles();
  const scheduledBaseAttempts = scheduleAttempts({
    taskId,
    taskType,
    maxAttempts,
    planner,
    evolutionPlanner: evolutionPlanner || planner?.evolutionPlanner,
    adaptiveSearch: planner?.adaptiveSearch,
  });
  const adaptiveSearchAction = firstAdaptiveSearchAction(scheduledBaseAttempts);
  if (adaptiveSearchAction?.trace) {
    await publishAttemptEvent(adaptiveSearchAction.trace);
  }
  const profiledAttempts = scheduledBaseAttempts.map((attempt) => ({
    ...attempt,
    profile: attempt.profile || selectAgentProfileForAttempt({
      profiles,
      attempt,
      task: { ...task, taskType },
      goalTree: (evolutionPlanner || planner?.evolutionPlanner)?.bidirectionalBes?.goalTree,
    }),
  }));
  const scheduledAttempts = evolutionBudget?.enabled
    ? allocateEvolutionSwarmBudgets({
      attempts: profiledAttempts,
      budgetState: evolutionBudget.budgetState || budget,
      maxOutputChars: evolutionBudget.maxOutputChars || budget.maxOutputChars || 1200,
      visualBudget: evolutionBudget.visualBudget || {},
    })
    : profiledAttempts;
  const concurrency = swarmExecution?.concurrency || 1;
  const attempts = await runSwarmAttemptsBounded({
    attempts: scheduledAttempts,
    concurrency,
    onAttemptEvent: (onAttemptEvent || emitEvent) ? async (event) => {
      const scheduledAttempt = event.attempt;
      if (event.type === 'started') {
        const requestId = hasModelWorker
          ? modelWorkerRequestId({ taskId, attemptId: scheduledAttempt.attemptId })
          : null;
        const workerKind = piNativeEnabled
          ? 'pi_native_subagent'
          : (hasModelWorker
            ? 'model_driven'
            : (hasWorktreeWorker ? 'worktree_command' : (commandAdapter ? 'command_subagent' : 'deterministic_subagent')));

        await publishAttemptEvent({
          type: 'swarm.subagent_started',
          taskId,
          attemptId: scheduledAttempt.attemptId,
          role: scheduledAttempt.profile?.role || 'implementer',
          profile: scheduledAttempt.profile,
          strategy: scheduledAttempt.strategy,
          planning: scheduledAttempt.planning,
          budget: scheduledAttempt.budget,
          budgetRationale: scheduledAttempt.budgetRationale,
          worker: {
            kind: workerKind,
            requestId,
            protocol: piNativeEnabled ? 'a2a' : undefined,
          },
          model: hasModelWorker ? { requestId, profileName: modelProfileName || scheduledAttempt.profile?.modelProfile || 'critic_low_temp' } : undefined,
          status: 'running',
          summary: `${scheduledAttempt.attemptId} running ${scheduledAttempt.strategy}`,
        });
        return;
      }

      const attemptRecord = event.attempt;
      await publishAttemptEvent({
        type: 'swarm.subagent_completed',
        taskId,
        attemptId: attemptRecord.attemptId,
        role: attemptRecord.role,
        profile: attemptRecord.profile,
        strategy: attemptRecord.strategy,
        planning: attemptRecord.planning,
        budget: attemptRecord.budget,
        budgetRationale: attemptRecord.budgetRationale,
        worker: attemptRecord.worker,
        model: attemptRecord.model,
        status: attemptRecord.status,
        summary: attemptRecord.output?.summary || `${attemptRecord.attemptId} ${attemptRecord.status}`,
        score: attemptRecord.score,
        verifierPassed: attemptRecord.verifierPassed,
        patchStats: attemptRecord.patchStats,
        thinkingSummary: attemptRecord.thinkingSummary,
        compactHandoff: attemptRecord.compactHandoff,
        handoffQuality: attemptRecord.handoffQuality,
        failure: attemptRecord.failure,
        startedAt: attemptRecord.startedAt,
        completedAt: attemptRecord.completedAt,
      });
    } : undefined,
    runAttempt: async ({ attempt: scheduledAttempt }) => {
    const attemptOutputContract = piNativeEnabled
      ? (scheduledAttempt.profile?.outputContract || outputContract)
      : outputContract;
    const attemptRecord = await runScheduledAttempt({
      task: { ...task, taskId },
      scheduledAttempt,
      role: scheduledAttempt.profile?.role || 'implementer',
      context,
      budget: { ...budget, ...(scheduledAttempt.budget || {}) },
      outputContract: attemptOutputContract,
      commandAdapter,
      verifierAdapter,
      command,
      verifierCommand,
      timeoutMs,
      workspaceRoot,
      worktreeManager,
      modelGateway,
      modelProvider,
      modelExecutor,
      provider,
      modelProfileName: modelProfileName || scheduledAttempt.profile?.modelProfile,
      piNativeEnabled,
      piWorkerFactory,
      emitAttemptTrace: publishAttemptEvent,
    });

    let localMeta = null;
    let cell = null;
    if (featureEnabled(featureFlags, 'localMetaHarness')) {
      cell = resolveAttemptCell({ attempt: scheduledAttempt, role: attemptRecord.role });
      localMeta = await runLocalMetaHarness({
        workspaceRoot,
        cell,
        attempt: attemptRecord,
        archive: featureFlags.localMetaArchive !== false,
      });
      attemptRecord.localMeta = localMeta;
      await publishAttemptEvent({
        type: 'local_meta.completed',
        taskId,
        attemptId: attemptRecord.attemptId,
        cellId: localMeta.cellId,
        candidateCount: localMeta.candidates.length,
        archiveCount: localMeta.archiveRecords.length,
        candidates: localMeta.candidates,
        summary: `${localMeta.cellId} local meta produced ${localMeta.candidates.length} candidate${localMeta.candidates.length === 1 ? '' : 's'}`,
      });
    }

    if (featureEnabled(featureFlags, 'localMemoryGraph')) {
      cell = cell || resolveAttemptCell({ attempt: scheduledAttempt, role: attemptRecord.role });
      const memoryProposals = attemptMemoryProposals(attemptRecord, localMeta || {});
      await publishAttemptEvent({
        type: 'local_memory.proposed',
        taskId,
        attemptId: attemptRecord.attemptId,
        cellId: localMeta?.cellId || cell.cellId,
        proposalCount: memoryProposals.length,
        memoryProposals,
        hardCaseTags: localMeta?.hardCaseTags || attemptRecord.evolutionOutput?.hardCaseTags || [],
        summary: `${memoryProposals.length} local memory proposal${memoryProposals.length === 1 ? '' : 's'} pending global review`,
      });
    }

    return attemptRecord;
    },
  });

  const reviews = attempts.map((attempt) => reviewAttempt({
    attempt,
    riskPolicy: buildRiskPolicy(context, riskPolicy),
  }));
  const recombination = recombineApprovedOutputs({ taskId, reviews });
  const champion = chooseChampion(attempts);
  let adaptiveSearchOutcome = null;
  if (adaptiveSearchAction?.actionId && planner?.adaptiveSearch?.scheduler) {
    adaptiveSearchOutcome = recordAdaptiveSearchOutcome({
      scheduler: planner.adaptiveSearch.scheduler,
      actionId: adaptiveSearchAction.actionId,
      reward: adaptiveSearchReward({ attempts, champion, budget }),
      evidence: {
        taskId,
        attemptCount: attempts.length,
        championAttemptId: champion?.attemptId || null,
      },
    });
    await publishAttemptEvent(adaptiveSearchOutcome);
    await publishAttemptEvent({
      type: 'ab_mcts.scheduler_summary',
      taskId,
      actionId: adaptiveSearchAction.actionId,
      selectedArm: adaptiveSearchAction.arm,
      arms: adaptiveSearchSchedulerSummary(planner.adaptiveSearch.scheduler),
    });
  }

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
      adaptiveSearch: adaptiveSearchAction
        ? {
          actionId: adaptiveSearchAction.actionId,
          selectedArm: adaptiveSearchAction.arm,
          advisory: adaptiveSearchAction.advisory,
          outcome: adaptiveSearchOutcome,
        }
        : null,
      attempts: scheduledAttempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        strategy: attempt.strategy,
        planning: attempt.planning,
      })),
    },
  };
}
