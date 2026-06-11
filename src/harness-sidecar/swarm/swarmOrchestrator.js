import { recordAdaptiveSearchOutcome } from '../bes/adaptiveSearchScheduler.js';
import { runLocalMetaHarness } from '../meta/localMetaHarness.js';
import { modelRouterRewardsFromSwarmResult } from '../model/modelRouterRewards.js';
import { scheduleAttempts } from './attemptScheduler.js';
import {
  applyAgentProfileModelOverrides,
  loadDefaultAgentProfiles,
  selectAgentProfileForAttempt,
} from './agentProfiles.js';
import { chooseChampion } from './championSelector.js';
import { allocateEvolutionSwarmBudgets } from './evolutionBudgetAllocator.js';
import { resolveAttemptModelRoute, summarizeModelCouncil } from './modelCouncil.js';
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

function oversoulAttemptMetadata(oversoulContext = null) {
  if (!oversoulContext?.oversoulRef) return {};
  return {
    oversoulRef: oversoulContext.oversoulRef,
    oversoulAdvisory: {
      authority: 'advisory',
      canPromote: false,
      roleEcology: oversoulContext.roleEcology,
      strategyPosture: oversoulContext.strategyPosture,
    },
  };
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

function routerEnabled(modelRouter = null) {
  return modelRouter?.enabled === true && typeof modelRouter?.policy?.selectArm === 'function';
}

function modelRouterDecisionKey({ role, taskType, attempt = {} } = {}) {
  return [
    role || attempt.profile?.role || 'implementer',
    taskType || 'general',
    attempt.planning?.action?.arm || attempt.strategy || 'attempt',
  ].join(':');
}

function modelRouterArms({ council, attempt = {}, role } = {}) {
  const arms = Object.values(council?.roleRoutes || {})
    .map((route) => ({
      armId: route.modelProfile,
      role: route.role,
      modelProfile: route.modelProfile,
      endpointProfile: route.endpointProfile,
      endpoint: route.endpoint,
      authority: 'evidence_only',
      canPromote: false,
    }))
    .filter((arm) => arm.modelProfile);
  const fallback = resolveAttemptModelRoute({ council, attempt, role });
  if (fallback?.modelProfile && !arms.some((arm) => arm.armId === fallback.modelProfile)) {
    arms.push({
      armId: fallback.modelProfile,
      role: fallback.role || role,
      modelProfile: fallback.modelProfile,
      endpointProfile: fallback.endpointProfile,
      endpoint: fallback.endpoint,
      authority: 'evidence_only',
      canPromote: false,
    });
  }
  return arms;
}

function routeFromRouterDecision({ decision = null, council, attempt = {}, role } = {}) {
  if (!decision?.modelProfile && !decision?.armId) return null;
  const matchingRoute = Object.values(council?.roleRoutes || {}).find((route) => (
    route.modelProfile === decision.modelProfile
    || route.modelProfile === decision.armId
    || route.endpointProfile === decision.endpointProfile
  ));
  return {
    role: decision.role || role || matchingRoute?.role || attempt.profile?.role || 'implementer',
    modelProfile: decision.modelProfile || decision.armId,
    endpointProfile: decision.endpointProfile || matchingRoute?.endpointProfile,
    endpoint: matchingRoute?.endpoint ? { ...matchingRoute.endpoint } : undefined,
    routerActionId: decision.actionId,
    routerArmId: decision.armId,
    authority: 'evidence_only',
    canPromote: false,
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
  modelRoute,
  piNativeEnabled = false,
  piWorkerFactory,
  piBridgeContext,
  capabilitiesManifest,
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
      piBridgeContext,
      capabilitiesManifest,
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
        modelRoute,
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
  modelCouncil,
  modelRouter,
  taskContext,
  piWorkerFactory,
  piBridgeContext,
  capabilitiesManifest,
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
  oversoulContext = null,
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
  const profiles = modelCouncil?.enabled
    ? applyAgentProfileModelOverrides({
      profiles: agentProfiles || loadDefaultAgentProfiles(),
      roleRoutes: modelCouncil.roleRoutes,
    })
    : (agentProfiles || loadDefaultAgentProfiles());
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
    ...oversoulAttemptMetadata(oversoulContext),
    profile: attempt.profile || selectAgentProfileForAttempt({
      profiles,
      attempt,
      task: { ...task, taskType },
      goalTree: (evolutionPlanner || planner?.evolutionPlanner)?.bidirectionalBes?.goalTree,
    }),
  }));
  const budgetedAttempts = evolutionBudget?.enabled
    ? allocateEvolutionSwarmBudgets({
      attempts: profiledAttempts,
      budgetState: evolutionBudget.budgetState || budget,
      maxOutputChars: evolutionBudget.maxOutputChars || budget.maxOutputChars || 1200,
      visualBudget: evolutionBudget.visualBudget || {},
    })
    : profiledAttempts;
  const modelRouterDecisions = [];
  const scheduledAttempts = [];
  for (const attempt of budgetedAttempts) {
    const role = attempt.profile?.role || 'implementer';
    let modelRoute = resolveAttemptModelRoute({
      council: modelCouncil,
      attempt,
      role,
    });
    if (routerEnabled(modelRouter)) {
      const key = modelRouterDecisionKey({ role, taskType, attempt });
      const decision = modelRouter.policy.selectArm({
        key,
        role,
        arms: modelRouterArms({ council: modelCouncil, attempt, role }),
        taskContext: taskContext || { ...task, taskType },
      });
      if (decision) {
        const normalizedDecision = {
          ...decision,
          authority: 'evidence_only',
          canPromote: false,
          key: decision.key || key,
          role: decision.role || role,
        };
        modelRouterDecisions.push(normalizedDecision);
        await publishAttemptEvent({
          ...normalizedDecision,
          type: 'model_router.arm_selected',
          taskId,
          attemptId: attempt.attemptId,
        });
        modelRoute = routeFromRouterDecision({
          decision: normalizedDecision,
          council: modelCouncil,
          attempt,
          role,
        }) || modelRoute;
      }
    }
    scheduledAttempts.push(modelRoute ? { ...attempt, modelRoute } : attempt);
  }
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
          oversoulRef: scheduledAttempt.oversoulRef,
          oversoulAdvisory: scheduledAttempt.oversoulAdvisory,
          worker: {
            kind: workerKind,
            requestId,
            protocol: piNativeEnabled ? 'a2a' : undefined,
          },
          model: hasModelWorker
            ? {
              requestId,
              profileName: scheduledAttempt.modelRoute?.modelProfile
                || modelProfileName
                || scheduledAttempt.profile?.modelProfile
                || 'critic_low_temp',
              route: scheduledAttempt.modelRoute,
            }
            : undefined,
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
        oversoulRef: attemptRecord.oversoulRef,
        oversoulAdvisory: attemptRecord.oversoulAdvisory,
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
      modelProfileName: scheduledAttempt.modelRoute?.modelProfile || modelProfileName || scheduledAttempt.profile?.modelProfile,
      modelRoute: scheduledAttempt.modelRoute,
      piNativeEnabled,
      piWorkerFactory,
      piBridgeContext,
      capabilitiesManifest,
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
  const modelCouncilReport = summarizeModelCouncil({ council: modelCouncil, attempts, champion, reviews });
  if (modelCouncil?.enabled) {
    await publishAttemptEvent({
      type: 'model_council.report_created',
      taskId,
      authority: 'evidence_only',
      canPromote: false,
      modelDiversity: modelCouncilReport.modelDiversity,
      coverage: modelCouncilReport.coverage,
      disagreement: modelCouncilReport.disagreement,
      championSupport: modelCouncilReport.championSupport,
    });
  }
  const modelRouterRewards = [];
  if (routerEnabled(modelRouter)) {
    const rewards = modelRouterRewardsFromSwarmResult({
      result: {
        taskId,
        taskType,
        attempts,
        modelCouncil: modelCouncilReport,
      },
      weights: modelRouter.rewardWeights,
    });
    for (const reward of rewards) {
      if (!reward.armId) continue;
      const rewardAttemptId = reward.evidence?.attemptId
        || attempts.find((candidate) => (
          candidate.model?.route?.modelProfile === reward.evidence?.modelProfile
          || candidate.model?.profileName === reward.evidence?.modelProfile
        ))?.attemptId
        || null;
      modelRouter.state?.recordReward?.(reward);
      modelRouterRewards.push(reward);
      await publishAttemptEvent({
        type: 'model_router.reward_recorded',
        taskId,
        attemptId: rewardAttemptId,
        authority: 'evidence_only',
        canPromote: false,
        key: reward.key,
        armId: reward.armId,
        reward: reward.reward,
        evidence: reward.evidence,
        reasons: reward.reasons,
      });
    }
  }
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
    modelCouncil: modelCouncilReport,
    modelRouter: routerEnabled(modelRouter)
      ? {
        authority: 'evidence_only',
        canPromote: false,
        decisions: modelRouterDecisions,
        rewards: modelRouterRewards,
      }
      : null,
    oversoul: oversoulContext
      ? {
        authority: 'advisory',
        canPromote: false,
        oversoulRef: oversoulContext.oversoulRef || null,
        roleEcology: oversoulContext.roleEcology,
        strategyPosture: oversoulContext.strategyPosture,
      }
      : null,
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
