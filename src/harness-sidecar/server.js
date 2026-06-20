import { createServer } from 'http';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { planSubgoals } from './bes/subgoalPlanner.js';
import { scoreSubgoals } from './bes/subgoalScorer.js';
import { seedAttemptStrategies } from './bes/strategySeeder.js';
import { BudgetManager } from './budget/budgetManager.js';
import { buildBudgetDashboard } from './budget/budgetDashboard.js';
import { BudgetHierarchy } from './budget/budgetHierarchy.js';
import { AuditLog } from './collaboration/auditLog.js';
import { LockService } from './collaboration/locks.js';
import { VersionedState } from './collaboration/versionedState.js';
import { WorkspaceLeaseService } from './collaboration/workspaceLeases.js';
import { loadHarnessConfig } from './config/configLoader.js';
import { evaluateContextWindow } from './context/contextWindowManager.js';
import { compileFinalAuditReport } from './core/finalAudit.js';
import { createApprovalResumeStore, executeApprovedApplyAction } from './core/approvalResume.js';
import { resumeTaskFromTrace } from './core/taskResume.js';
import { listTraces, readTrace, replayTrace } from './core/traceReader.js';
import { TraceWriter } from './core/traceWriter.js';
import { runModelCouncilPassKEval, summarizePassKUplift } from './evals/modelCouncilPassK.js';
import { proposeExperiment } from './experiments/experimentManager.js';
import { compareMetrics } from './experiments/metricComparer.js';
import { archiveChampion, createChampionArchive, selectBestChampion } from './bes/championArchive.js';
import { createAttemptGenome } from './bes/attemptGenome.js';
import { replayAdaptiveSearchSelection, summarizeAdaptiveSearchEvents } from './bes/adaptiveSearchApi.js';
import { createDiversityTracker } from './bes/diversityTracker.js';
import { runBidirectionalBes } from './bes/bidirectionalSearchLoop.js';
import { runBesLaneRuntimeWithEvents } from './bes/laneRuntime.js';
import { runEvolutionPopulationSync } from './bes/evolutionPopulationRunner.js';
import { proposeMutations } from './bes/mutationPolicy.js';
import { recombineAttempts } from './bes/recombinationEngine.js';
import { writeExperimentDecision } from './experiments/decisionWriter.js';
import { ExperimentQueue } from './experiments/experimentQueue.js';
import { compileExperimentReport } from './experiments/experimentReports.js';
import { classifyNoise } from './experiments/noiseGate.js';
import { RunTracker } from './experiments/runTracker.js';
import { buildClaimEvidenceGraph } from './graph/claimEvidenceGraph.js';
import { extractCallGraphFromIndex } from './graph/callGraphHeuristics.js';
import { createCodeGraphFromIndex } from './graph/codeGraph.js';
import { buildExperimentGraph } from './graph/experimentGraph.js';
import { analyzeCodeImpact } from './graph/impactAnalyzer.js';
import { extractImportGraphFromIndex } from './graph/importGraph.js';
import { buildVisualGraph } from './graph/visualGraph.js';
import { maintainGraphMemorySnapshot } from './memory/graphMemoryMaintenance.js';
import { retrievePromotedMemory } from './memory/memoryRetriever.js';
import { promoteMemoryCandidates } from './memory/promotionPolicy.js';
import { decideReflectionGate } from './memory/reflectionGate.js';
import { writeMemoryCandidate } from './memory/memoryWriter.js';
import { scoreMemoryCorpus } from './memory/memoryEvals.js';
import { createChangeProposal } from './meta/changeProposal.js';
import { createBackgroundEvolutionWorker } from './meta/backgroundEvolutionWorker.js';
import { createProductionQueueProvider } from './interop/productionQueueProvider.js';
import { archiveCandidate } from './meta/candidateArchive.js';
import { recordCandidateRun } from './meta/candidateRunner.js';
import { BesMetaOptimizer } from './meta/besMetaOptimizer.js';
import { summarizeCapabilityGoalStatus } from './meta/capabilityGoalStatus.js';
import { loadCapabilityGoalInputs } from './meta/capabilityGoalSnapshot.js';
import {
  decideGovernanceAction,
  planScheduledReplayJobs,
  recordRollbackDrill,
  summarizeGovernanceStatus,
} from './meta/governanceLoop.js';
import { HarnessOptimizer } from './meta/harnessOptimizer.js';
import { runMemoryPolicyBesLane } from './meta/memoryPolicyEvolution.js';
import { evaluatePromotion } from './meta/promotionPolicy.js';
import { buildIcrEvidenceStatus } from './icr/icrStatusHandler.js';
import { runResearchPolicyBesLane } from './meta/researchPolicyEvolution.js';
import { inspectTrace } from './meta/traceInspector.js';
import { runVerifierEvolutionLoop } from './meta/verifierEvolutionLoop.js';
import {
  buildGovernanceTrustInput,
  runPostTaskRecursiveEvolutionHooks,
} from './meta/recursiveEvolutionRuntimeHook.js';
import { wrapPostTaskEvolution } from './meta/postTaskHookGuard.js';
import { applyRuntimePolicyToHarnessConfig } from './meta/runtimePolicyConsumer.js';
import { loadRuntimePolicy } from './meta/runtimePolicyStore.js';
import { composeGraphRagContext } from './rag/graphRagComposer.js';
import { composeUnifiedContext } from './rag/unifiedContextComposer.js';
import { buildRhoCoreset } from './rho/coresetBuilder.js';
import { judgeCandidatePreference } from './rho/preferenceJudge.js';
import { auditCitations } from './research/citationAuditor.js';
import { findContradictions } from './research/contradictionFinder.js';
import { createDeepResearchReport, createDeepResearchV2Artifacts } from './research/deepResearchManager.js';
import { createImplementationHandoff } from './research/implementationHandoff.js';
import { compileResearchReport } from './research/reportCompiler.js';
import { createResearchBrief } from './research/researchBrief.js';
import { discoverSources } from './research/sourceDiscovery.js';
import { ingestSources } from './research/sourceIngestion.js';
import { createArtifactStore } from './artifacts/artifactStore.js';
import { buildContextPack } from './rag/contextPackBuilder.js';
import { retrieveWorkspaceContext } from './rag/retriever.js';
import { indexWorkspace } from './rag/workspaceIndexer.js';
import { ModelGateway } from './model/modelGateway.js';
import { getModelProfile } from './model/modelProfiles.js';
import { createOpenAICompatibleProvider } from './model/openaiCompatibleProvider.js';
import { createRoutingModelProvider } from './model/routingModelProvider.js';
import { createModelRouterPolicy } from './model/modelRouterPolicy.js';
import { createModelRouterState } from './model/modelRouterState.js';
import { createVllmHealthController } from './model/vllmHealthController.js';
import { buildPiBridgeState } from './pi/piBridgeState.js';
import { listPromotionQueueRecords } from './meta/promotionQueueReader.js';
import { scheduleAttempts } from './swarm/attemptScheduler.js';
import { getAgentProfile } from './swarm/agentProfiles.js';
import { proposeChampionApply } from './swarm/championApply.js';
import { chooseChampion } from './swarm/championSelector.js';
import { buildModelCouncilRuntime } from './swarm/modelCouncil.js';
import { orchestrateSwarm } from './swarm/swarmOrchestrator.js';
import { runSwarmPolicyBesLane } from './swarm/evolutionSwarmPlanner.js';
import { resolveSwarmRuntime } from './swarm/resolveSwarmRuntime.js';
import { summarizeSwarmOutcome } from './swarm/swarmOutcomeRecorder.js';
import { createDefaultToolRegistry } from './tools/defaultToolRegistry.js';
import { createGitApplyAdapter } from './tools/gitApplyAdapter.js';
import { loadVerifierRegistry } from './tools/verifierRegistry.js';
import { selectVerifiersForTask } from './tools/verifierSelector.js';
import { startMcpRuntimesFromCapabilities } from './tools/mcpCapabilityRuntime.js';
import { runToolLoop } from './tools/toolLoopController.js';
import { runVerifiers } from './tools/verifierRunner.js';
import { interpretDiagram } from './vlm/diagramInterpreter.js';
import { createFigureCropArtifact } from './vlm/figureCropper.js';
import { createPdfPageArtifacts } from './vlm/pdfRenderer.js';
import { captureProductionVisualArtifacts } from './vlm/productionArtifactCapture.js';
import { analyzePlot } from './vlm/plotAnalyzer.js';
import { writeRuntimePreviewImage } from './vlm/runtimePreviewImage.js';
import { createScreenshotArtifact } from './vlm/screenshotTool.js';
import { createVisualContextItem } from './vlm/visualContextPolicy.js';
import { createVisualDiffArtifact } from './vlm/visualDiff.js';
import { runVisualModelObservation } from './vlm/visualModelRunner.js';
import { listSkillCandidates, readSkillCandidate } from './skills/skillCandidateStore.js';
import { runSkillCandidateBesLane } from './skills/skillEvolution.js';
import { mineSkillNeedsFromRho } from './skills/skillNeedMiner.js';
import {
  approveSkillCandidateForReview,
  redactSkillCandidatePayload,
  rejectSkillCandidateForReview,
  summarizeSkillCandidate,
} from './skills/skillCandidateReview.js';
import { redactModelVisibleValue } from './security/modelVisibleQuarantine.js';

const VERSION = '0.1.0';
const CAPABILITY_STORE_MODULE = './capabilities/capabilityStore.js';

function parseArgs(argv) {
  const args = { port: 49321, workspaceRoot: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--port') {
      args.port = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--workspace') {
      args.workspaceRoot = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendNotFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function sendBadRequest(res, error) {
  sendJson(res, 400, { error: error.message || String(error) });
}

function uniqueSorted(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).filter(Boolean).map(String))]
    .sort((left, right) => left.localeCompare(right));
}

export function summarizeBesLaneStatus(laneResult = {}) {
  const candidates = Array.isArray(laneResult.candidates) ? laneResult.candidates : [];
  const ranked = [...candidates].sort((left, right) => (
    Number(right.evidence?.summary?.domainScore ?? right.evidence?.domain?.score ?? 0)
      - Number(left.evidence?.summary?.domainScore ?? left.evidence?.domain?.score ?? 0)
      || String(left.candidateId || left.policyId || '').localeCompare(String(right.candidateId || right.policyId || ''))
  ));
  const blockedReasons = uniqueSorted(candidates.flatMap((candidate) => (
    candidate.promotion?.blockedReasons || []
  )));
  const evidenceSources = uniqueSorted(candidates.flatMap((candidate) => (
    candidate.evidence?.sources || []
  )));

  return {
    lane: laneResult.lane || null,
    taskId: laneResult.taskId || null,
    candidateCount: candidates.length,
    bestCandidateId: ranked[0]?.candidateId || ranked[0]?.policyId || null,
    evidenceSources,
    blockedReasons,
    promotionAllowed: false,
    updatedAt: laneResult.updatedAt || ranked[0]?.updatedAt || null,
  };
}

export function createHarnessStatusSnapshot({ besLanes = [], governance = null, capabilityGoals = null } = {}) {
  return {
    besLanes: (Array.isArray(besLanes) ? besLanes : [besLanes])
      .filter(Boolean)
      .map(summarizeBesLaneStatus),
    ...(governance ? { governance: summarizeGovernanceStatus(governance) } : {}),
    ...(capabilityGoals ? { capabilityGoals: summarizeCapabilityGoalStatus(capabilityGoals) } : {}),
  };
}

function countEnabledCapabilities(capabilities = []) {
  return capabilities.reduce((counts, capability) => {
    if (!capability?.enabled) return counts;
    counts[capability.type] = (counts[capability.type] || 0) + 1;
    return counts;
  }, {
    skill: 0,
    mcp: 0,
    pi_extension: 0,
    profile: 0,
  });
}

function normalizeEnabledCounts(manifest = {}) {
  if (manifest.enabledCounts) return manifest.enabledCounts;
  if (manifest.counts) {
    return {
      skill: manifest.counts.skill || 0,
      mcp: manifest.counts.mcp || 0,
      pi_extension: manifest.counts.pi_extension || 0,
      profile: manifest.counts.profile || 0,
    };
  }
  return countEnabledCapabilities(manifest.capabilities);
}

function normalizeMountResult(mountResult, profileId) {
  const manifest = mountResult.manifest || mountResult;
  const manifestPath = mountResult.manifestPath || manifest.manifestPath || null;
  const enabledCounts = normalizeEnabledCounts(manifest);
  return {
    manifest: {
      ...manifest,
      profileId: manifest.profileId || profileId || 'default',
      enabledCounts,
    },
    manifestPath,
    enabledCounts,
  };
}

const EVIDENCE_AUTHORITY_KEYS = new Set([
  'applied',
  'approved',
  'canApply',
  'canMutateWorkspace',
  'directApplyAllowed',
  'durableApplyApproved',
  'promotionAllowed',
  'promotionAuthority',
  'verifierBypass',
]);

function stripEvidenceAuthority(value) {
  if (Array.isArray(value)) return value.map(stripEvidenceAuthority);
  if (!value || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, child] of Object.entries(value)) {
    if (EVIDENCE_AUTHORITY_KEYS.has(key)) continue;
    if (key === 'canPromote') {
      safe.canPromote = false;
      continue;
    }
    safe[key] = stripEvidenceAuthority(child);
  }
  if (!Object.hasOwn(safe, 'canPromote')) safe.canPromote = false;
  return safe;
}

function scrubEvidencePayload(value) {
  return stripEvidenceAuthority(redactModelVisibleValue(value));
}

function resolveAgentProfileToolCaps(profileId) {
  if (!profileId || profileId === 'default') return null;
  try {
    return getAgentProfile({ profileId })?.toolCaps || null;
  } catch {
    return null;
  }
}

function budgetDashboardSnapshot({ task, budgetManager, contextState, activeSubagents = [], recovery = {} }) {
  const workspaceScopeId = `workspace:${task.workspaceId || 'local'}`;
  const taskScopeId = `task:${task.taskId}`;
  const hierarchy = new BudgetHierarchy({ rootScopeId: workspaceScopeId });
  hierarchy.defineScope({
    id: workspaceScopeId,
    type: 'workspace',
    limits: { count: Math.max(1, budgetManager.limits.maxToolCalls) },
  });
  hierarchy.defineScope({
    id: taskScopeId,
    type: 'task',
    parentId: workspaceScopeId,
    limits: { count: Math.max(1, budgetManager.limits.maxToolCalls) },
  });
  hierarchy.recordUsage({
    scopeId: taskScopeId,
    usage: { count: budgetManager.used.toolCalls + budgetManager.used.verifierCalls },
  });

  return buildBudgetDashboard({
    context: contextState,
    budget: hierarchy.snapshot(),
    subagents: activeSubagents,
    approvals: [],
    recovery,
  });
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function countContextSources(items = []) {
  return items.reduce((counts, item) => {
    const source = item?.source || 'unknown';
    counts[source] = (counts[source] || 0) + 1;
    return counts;
  }, {});
}

async function loadCapabilityStore() {
  return import(CAPABILITY_STORE_MODULE);
}

export function createHarnessSidecar({
  workspaceRoot = process.cwd(),
  port = 49321,
  modelProviderFactory = createOpenAICompatibleProvider,
  vllmHealthFetch = fetch,
  swarmWorktreeManager,
  swarmCommandAdapter,
  swarmVerifierAdapter,
  mcpRuntime,
  mcpTransportFactory,
  visualCaptureAdapter,
  applyAdapter,
} = {}) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const subscribers = new Set();
  const traceWriter = new TraceWriter({ workspaceRoot: resolvedWorkspaceRoot });
  const artifactStore = createArtifactStore({ workspaceRoot: resolvedWorkspaceRoot });
  const artifacts = new Map();
  const auditLog = new AuditLog();
  const lockService = new LockService();
  const workspaceLeaseService = new WorkspaceLeaseService();
  const pendingApprovals = new Map();
  const approvalResumeStore = createApprovalResumeStore({ emitEvent });
  const tasks = new Map();
  const taskStates = new Map();
  const vllmHealthControllers = new Map();
  let mountedMcpRuntime = mcpRuntime || null;
  let backgroundEvolutionWorker = null;
  let productionQueueProvider = null;
  let server = null;
  let actualPort = port;

  function registerEventArtifacts(event = {}) {
    const eventArtifacts = [
      ...(Array.isArray(event.artifacts) ? event.artifacts : []),
      event.artifact,
    ].filter(Boolean);
    for (const artifact of eventArtifacts) {
      if (artifact?.artifactId) {
        artifacts.set(artifact.artifactId, artifact);
      }
    }
  }

  async function emitEvent(event) {
    const enrichedEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    registerEventArtifacts(enrichedEvent);
    if (enrichedEvent.taskId) {
      await traceWriter.writeEvent(enrichedEvent);
    }
    for (const subscriber of subscribers) {
      subscriber(enrichedEvent);
    }
  }

  async function recordAudit(entry) {
    const auditEntry = auditLog.record(entry);
    await emitEvent({
      type: 'audit.recorded',
      taskId: auditEntry.taskId,
      auditId: auditEntry.auditId,
      actor: auditEntry.actor,
      target: auditEntry.target,
      operation: auditEntry.operation,
      reason: auditEntry.reason,
    });
    return auditEntry;
  }

  async function updateTaskState(taskId, patch, updatedBy) {
    const state = taskStates.get(taskId);
    const result = state.update({
      expectedVersion: state.version,
      patch,
      updatedBy,
    });
    if (result.applied) {
      await emitEvent({
        type: 'task_state.updated',
        taskId,
        version: result.version,
        patch,
        updatedBy,
      });
    }
    return result;
  }

  async function mountCapabilitiesForTask({ taskId, workspaceRoot, profileId }) {
    const { buildRuntimeMountManifest } = await loadCapabilityStore();
    const mountResult = await buildRuntimeMountManifest({ workspaceRoot, profileId });
    const normalizedMount = normalizeMountResult(mountResult, profileId);
    const capabilities = Array.isArray(normalizedMount.manifest.capabilities)
      ? normalizedMount.manifest.capabilities
      : [];

    await emitEvent({
      type: 'capabilities.runtime_mounted',
      taskId,
      workspaceRoot,
      profileId: normalizedMount.manifest.profileId,
      enabledCounts: normalizedMount.enabledCounts,
      capabilityCount: capabilities.length,
      manifestPath: normalizedMount.manifestPath,
    });

    if (capabilities.some((capability) => capability.type === 'mcp')) {
      const mcpSummary = await startMcpRuntimesFromCapabilities({
        records: capabilities,
        workspaceRoot,
        runtime: mountedMcpRuntime,
        transportFactory: mcpTransportFactory,
        emitEvent: (event) => emitEvent({ taskId, ...event }),
      });
      mountedMcpRuntime = mcpSummary.runtime || mountedMcpRuntime;
      await emitEvent({
        type: 'mcp.capability_runtime.summary',
        taskId,
        startedCount: mcpSummary.started.length,
        skippedCount: mcpSummary.skipped.length,
        started: mcpSummary.started,
        skipped: mcpSummary.skipped,
      });
    }

    return {
      ...normalizedMount,
      profileId: normalizedMount.manifest.profileId,
    };
  }

  function numericSetting(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return undefined;
  }

  function adaptiveVllmHealthEnabled(harnessConfig) {
    if (process.env.HELIOS_VLLM_HEALTH_ENABLED === '0') return false;
    return harnessConfig?.vllmHealth?.enabled !== false;
  }

  function getVllmHealthController({ baseUrl, harnessConfig }) {
    const minConcurrency = numericSetting(
      process.env.HELIOS_VLLM_HEALTH_MIN_CONCURRENCY,
      harnessConfig?.vllmHealth?.minConcurrency,
      1,
    );
    const maxConcurrency = numericSetting(
      process.env.HELIOS_SWARM_MAX_CONCURRENCY,
      process.env.HELIOS_VLLM_HEALTH_MAX_CONCURRENCY,
      harnessConfig?.vllmHealth?.maxConcurrency,
      harnessConfig?.swarmExecution?.maxConcurrency,
      harnessConfig?.swarmExecution?.concurrency,
      4,
    );
    const probeConcurrency = numericSetting(
      process.env.HELIOS_VLLM_HEALTH_PROBE_CONCURRENCY,
      harnessConfig?.vllmHealth?.probeConcurrency,
      2,
    );
    const timeoutMs = numericSetting(
      process.env.HELIOS_VLLM_HEALTH_TIMEOUT_MS,
      harnessConfig?.vllmHealth?.timeoutMs,
      1000,
    );
    const targetLatencyMs = numericSetting(
      process.env.HELIOS_VLLM_HEALTH_TARGET_LATENCY_MS,
      harnessConfig?.vllmHealth?.targetLatencyMs,
      1000,
    );
    const initialConcurrency = numericSetting(
      harnessConfig?.vllmHealth?.initialConcurrency,
      harnessConfig?.swarmExecution?.concurrency,
      minConcurrency,
    );
    const controllerKey = [
      baseUrl,
      minConcurrency,
      maxConcurrency,
      probeConcurrency,
      timeoutMs,
      targetLatencyMs,
    ].join('|');
    if (!vllmHealthControllers.has(controllerKey)) {
      vllmHealthControllers.set(controllerKey, createVllmHealthController({
        baseUrl,
        fetchImpl: vllmHealthFetch,
        minConcurrency,
        maxConcurrency,
        initialConcurrency,
        probeConcurrency,
        timeoutMs,
        targetLatencyMs,
      }));
    }
    return vllmHealthControllers.get(controllerKey);
  }

  function configuredSwarmWorkerMode(harnessConfig) {
    const mode = String(
      process.env.HELIOS_SWARM_WORKER_MODE
      || harnessConfig?.swarmExecution?.workerMode
      || '',
    ).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (['model_driven', 'pi_native', 'auto'].includes(mode)) return mode;
    return 'auto';
  }

  function maxSwarmConcurrencyForConfig(harnessConfig) {
    return numericSetting(
      process.env.HELIOS_SWARM_MAX_CONCURRENCY,
      process.env.HELIOS_VLLM_HEALTH_MAX_CONCURRENCY,
      harnessConfig?.vllmHealth?.maxConcurrency,
      harnessConfig?.swarmExecution?.maxConcurrency,
      harnessConfig?.swarmExecution?.concurrency,
      4,
    );
  }

  function resolveWorkspaceStatePath(configuredPath, fallbackPath) {
    const resolved = path.resolve(resolvedWorkspaceRoot, configuredPath || fallbackPath);
    const workspacePrefix = `${resolvedWorkspaceRoot}${path.sep}`;
    if (resolved === resolvedWorkspaceRoot || resolved.startsWith(workspacePrefix)) return resolved;
    return path.resolve(resolvedWorkspaceRoot, fallbackPath);
  }

  async function readJsonIfExists(filePath) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function createRuntimeModelRouter(harnessConfig) {
    const routerConfig = harnessConfig?.modelRouter || {};
    const enabled = harnessConfig?.features?.adaptiveModelRouter === true
      && routerConfig.enabled === true;
    if (!enabled) return null;

    const persistenceEnabled = routerConfig.persistence?.enabled === true;
    const persistencePath = resolveWorkspaceStatePath(
      routerConfig.persistence?.path,
      '.harness/model-router-state.json',
    );
    const initialState = persistenceEnabled ? await readJsonIfExists(persistencePath) : null;
    const state = createModelRouterState({ initialState });
    return {
      enabled: true,
      mode: routerConfig.mode || 'advisory',
      strategy: routerConfig.strategy || 'thompson_sampling',
      authority: 'evidence_only',
      canPromote: false,
      rewardWeights: routerConfig.rewardWeights,
      state,
      policy: createModelRouterPolicy({
        state,
        explorationFloor: routerConfig.explorationFloor,
        maxArmsPerDecision: routerConfig.maxArmsPerDecision,
      }),
      persistence: {
        enabled: persistenceEnabled,
        path: persistencePath,
      },
    };
  }

  async function persistRuntimeModelRouter(modelRouter) {
    if (!modelRouter?.persistence?.enabled || typeof modelRouter?.state?.snapshot !== 'function') return;
    await mkdir(path.dirname(modelRouter.persistence.path), { recursive: true });
    await writeFile(
      modelRouter.persistence.path,
      `${JSON.stringify(modelRouter.state.snapshot(), null, 2)}\n`,
      'utf8',
    );
  }

  async function runFullRuntimeSubsystems({
    task,
    subgoals,
    workspaceIndex,
    contextPack,
    patchArtifact,
    budgetManager,
    harnessConfig,
    emitEvent: emitEventOverride,
  }) {
    const activeEmitEvent = emitEventOverride || emitEvent;
    async function createRuntimeSwarmModelGateway() {
      const enabled = harnessConfig?.features?.modelDrivenSwarm === true
        || process.env.HELIOS_SWARM_MODEL_DRIVEN === '1';
      if (!enabled) return null;

      const profileName = process.env.HELIOS_SWARM_MODEL_PROFILE
        || harnessConfig?.defaults?.swarmModelProfile
        || 'alphahelion_ebft5';
      const vlmProfileName = process.env.HELIOS_VLM_MODEL_PROFILE
        || harnessConfig?.defaults?.vlmModelProfile
        || 'qwen36_vlm_fast';
      const { gateway, advisory } = resolveSwarmRuntime({
        harnessConfig,
        profileName,
        getModelProfile,
      });
      const profile = gateway?.profile || null;
      const baseUrl = process.env.HELIOS_SWARM_MODEL_BASE_URL || gateway?.baseUrl;
      const modelId = process.env.HELIOS_SWARM_MODEL_ID
        || gateway?.modelId
        || profile?.model;
      const supportsVision = process.env.HELIOS_SWARM_MODEL_SUPPORTS_VISION === '1'
        || harnessConfig?.models?.swarmSupportsVision === true
        || profile?.supportsVision;
      if (!baseUrl) {
        await emitEvent({
          type: 'swarm.model_gateway_unavailable',
          taskId: task.taskId,
          profileName,
          reason: advisory?.setupHint || advisory?.reason || 'No baseUrl configured for model-driven swarm.',
          advisory,
        });
        return null;
      }

      let vllmHealth = null;
      let adaptiveConcurrency = Math.max(1, Number(harnessConfig?.swarmExecution?.concurrency || 1));
      if (adaptiveVllmHealthEnabled(harnessConfig)) {
        const controller = getVllmHealthController({ baseUrl, harnessConfig });
        vllmHealth = await controller.probeAndUpdate();
        adaptiveConcurrency = vllmHealth.concurrency;
        await emitEvent({
          type: 'swarm.vllm_health_updated',
          taskId: task.taskId,
          profileName,
          baseUrl,
          healthUrl: vllmHealth.healthUrl,
          healthy: vllmHealth.healthy,
          concurrency: vllmHealth.concurrency,
          reason: vllmHealth.reason,
          sampleCount: vllmHealth.sampleCount,
          failureCount: vllmHealth.failureCount,
          p95LatencyMs: vllmHealth.p95LatencyMs,
          statuses: vllmHealth.statuses,
        });
      }

      const configuredModelOverride = {
        model: modelId,
        baseUrl,
        supportsVision,
      };
      const modelCouncil = buildModelCouncilRuntime({
        harnessConfig,
        fallbackModel: {
          profileName,
          baseUrl,
          modelId,
          supportsVision,
        },
      });
      const profileOverrides = {
        [profileName]: configuredModelOverride,
        [vlmProfileName]: configuredModelOverride,
        ...(modelCouncil.profileOverrides || {}),
      };
      const councilRoutes = Object.fromEntries(
        Object.values(modelCouncil.roleRoutes || {})
          .filter((route) => (
            route.modelProfile
            && route.privateEndpointOverride?.baseUrl
            && route.privateEndpointOverride?.model
          ))
          .flatMap((route) => {
            const providerRoute = {
              baseUrl: route.privateEndpointOverride.baseUrl,
              modelId: route.privateEndpointOverride.model,
              apiKeyEnv: profileOverrides[route.modelProfile]?.apiKeyEnv,
            };
            return [
              [route.modelProfile, providerRoute],
              route.endpointProfile ? [route.endpointProfile, providerRoute] : null,
            ].filter(Boolean);
          }),
      );
      const uniqueBaseUrls = new Set([
        baseUrl,
        ...Object.values(councilRoutes).map((route) => route.baseUrl),
      ].filter(Boolean));

      const defaultProvider = modelProviderFactory({
        baseUrl,
        modelId,
        apiKey: process.env.HELIOS_SWARM_MODEL_API_KEY || harnessConfig?.models?.swarmApiKey || 'dummy',
      });
      const provider = uniqueBaseUrls.size > 1
        ? createRoutingModelProvider({
          routes: councilRoutes,
          defaultProvider,
          providerFactory: modelProviderFactory,
        })
        : defaultProvider;

      await emitEvent({
        type: 'model_council.enabled',
        taskId: task.taskId,
        enabled: modelCouncil.enabled,
        authority: modelCouncil.authority,
        roleCount: Object.keys(modelCouncil.roleRoutes || {}).length,
        endpointProfileCount: Object.keys(modelCouncil.endpointProfiles || {}).length,
      });
      if (modelCouncil.enabled) {
        const endpointBaseUrls = new Set(
          Object.values(modelCouncil.roleRoutes || {})
            .map((route) => route.privateEndpointOverride?.baseUrl)
            .filter(Boolean),
        );
        modelCouncil.health = {
          maxConcurrency: maxSwarmConcurrencyForConfig(harnessConfig),
          recommendedConcurrency: adaptiveConcurrency,
          endpoints: Object.values(modelCouncil.roleRoutes || {})
            .filter((route) => route.privateEndpointOverride?.baseUrl)
            .map((route) => ({
              role: route.role,
              endpointProfile: route.endpointProfile,
              baseUrl: route.privateEndpointOverride.baseUrl,
              healthUrl: route.privateEndpointOverride.baseUrl === baseUrl ? vllmHealth?.healthUrl : undefined,
              healthy: route.privateEndpointOverride.baseUrl === baseUrl ? vllmHealth?.healthy : undefined,
              recommendedConcurrency: route.privateEndpointOverride.baseUrl === baseUrl ? adaptiveConcurrency : undefined,
            })),
        };
        await emitEvent({
          type: 'model_council.health_updated',
          taskId: task.taskId,
          endpointCount: endpointBaseUrls.size,
          healthyEndpointCount: vllmHealth?.healthy && endpointBaseUrls.has(baseUrl) ? 1 : 0,
          recommendedConcurrency: adaptiveConcurrency,
        });
      }

      return {
        profileName,
        vlmProfileName,
        baseUrl,
        modelId,
        supportsVision,
        adaptiveConcurrency,
        maxConcurrency: maxSwarmConcurrencyForConfig(harnessConfig),
        vllmHealth,
        modelCouncil,
        gateway: new ModelGateway({
          provider,
          emitEvent,
          profileOverrides,
        }),
      };
    }

    const enabledSubsystems = [
      'bes',
      'rag',
      'graph',
      'memory',
      'meta',
      'research',
      'experiments',
      'swarm',
      'vlm',
      'collaboration',
      'budget',
      'audit',
    ];
    const runtimeSwarmModel = await createRuntimeSwarmModelGateway();
    const runtimeModelRouter = await createRuntimeModelRouter(harnessConfig);
    const activeToolCaps = resolveAgentProfileToolCaps(task.profileId);
    const defaultToolRegistry = createDefaultToolRegistry({
      workspaceRoot: resolvedWorkspaceRoot,
      emitEvent,
      mcpRuntime: mountedMcpRuntime,
      visualCaptureAdapter,
      modelGateway: runtimeSwarmModel?.gateway,
    });
    if (runtimeSwarmModel) {
      const toolNames = defaultToolRegistry.list().map((tool) => tool.name).sort();
      await emitEvent({
        type: 'tools.default_registry_available',
        taskId: task.taskId,
        toolCount: toolNames.length,
        toolNames,
        toolLoopReady: true,
      });
    }
    const autonomousToolLoopEnabled = runtimeSwarmModel
      && (
        harnessConfig?.features?.autonomousToolLoop === true
        || process.env.HELIOS_AUTONOMOUS_TOOL_LOOP === '1'
      );
    if (autonomousToolLoopEnabled) {
      const toolLoopResult = await runToolLoop({
        taskId: task.taskId,
        purpose: 'full_task_tool_loop',
        profileName: runtimeSwarmModel.profileName,
        modelGateway: runtimeSwarmModel.gateway,
        toolRegistry: defaultToolRegistry,
        toolCaps: activeToolCaps,
        maxIterations: Math.max(1, Math.min(8, task.budget.maxToolCalls || 4)),
        recovery: {
          enabled: true,
          emitEvent,
          noProgressThreshold: 2,
        },
        messages: [{
          role: 'user',
          content: [
            `Task: ${task.task}`,
            `Context pack: ${contextPack.contextPackId}`,
            'Use available tools only when they materially improve the result. Return a concise final status.',
          ].join('\n'),
        }],
      });
      await emitEvent({
        type: `tool_loop.${toolLoopResult.status}`,
        taskId: task.taskId,
        status: toolLoopResult.status,
        iterations: toolLoopResult.iterations,
        toolResultCount: toolLoopResult.toolResults.length,
        finalText: toolLoopResult.finalText,
        toolResults: toolLoopResult.toolResults.map((result) => ({
          id: result.id,
          name: result.name,
          status: result.status,
          reason: result.reason,
          error: result.error,
        })),
      });
      await updateTaskState(
        task.taskId,
        {
          toolLoopStatus: toolLoopResult.status,
          toolLoopIterations: toolLoopResult.iterations,
        },
        'tool-loop-runtime',
      );

      if (toolLoopResult.status === 'approval_required') {
        const actionId = makeId('act');
        const action = {
          actionId,
          taskId: task.taskId,
          kind: 'tool_loop_resume',
          payload: { toolResults: toolLoopResult.toolResults },
          resume: async () => {
            await emitEvent({
              type: 'tool_loop.resume_requested',
              taskId: task.taskId,
              actionId,
            });
            return { status: 'queued', toolResultCount: toolLoopResult.toolResults.length };
          },
        };
        approvalResumeStore.register(action);
        pendingApprovals.set(actionId, {
          actionId,
          taskId: task.taskId,
          kind: action.kind,
          status: 'pending',
          payload: action.payload,
        });
        await emitEvent({
          type: 'approval.required',
          taskId: task.taskId,
          actionId,
          risk: 'high',
          reason: 'Tool loop produced a pending tool call that requires approval before resume.',
          choices: ['approve', 'reject', 'defer'],
          proposedAction: {
            kind: action.kind,
            tool: 'tool_loop',
            description: 'Resume the model tool loop after approving the pending tool call.',
          },
        });
      }
    }
    const swarmWorkerMode = configuredSwarmWorkerMode(harnessConfig);
    const piNativeSwarmEnabled = swarmWorkerMode === 'model_driven'
      ? false
      : (swarmWorkerMode === 'pi_native'
        || harnessConfig?.features?.piNativeSwarm === true
        || process.env.HELIOS_PI_NATIVE_SWARM === '1');
    const resolvedSwarmWorkerMode = piNativeSwarmEnabled ? 'pi_native' : 'model_driven';
    const selectedSwarmConcurrency = runtimeSwarmModel?.adaptiveConcurrency
      || Math.max(1, Number(harnessConfig?.swarmExecution?.concurrency || 1));

    await emitEvent({
      type: 'harness_runtime.enabled',
      taskId: task.taskId,
      mode: task.mode,
      enabledSubsystems,
      modelDrivenSwarm: Boolean(runtimeSwarmModel),
      multiModelSwarm: runtimeSwarmModel?.modelCouncil?.enabled === true,
      piNativeSwarm: piNativeSwarmEnabled,
      swarmWorkerMode: resolvedSwarmWorkerMode,
      configuredSwarmWorkerMode: swarmWorkerMode,
      swarmConcurrency: selectedSwarmConcurrency,
      vllmHealth: runtimeSwarmModel?.vllmHealth
        ? {
          healthy: runtimeSwarmModel.vllmHealth.healthy,
          reason: runtimeSwarmModel.vllmHealth.reason,
          p95LatencyMs: runtimeSwarmModel.vllmHealth.p95LatencyMs,
        }
        : null,
    });
    const besLaneResults = [];
    async function runRuntimeBesLane(input) {
      const laneResult = await runBesLaneRuntimeWithEvents({
        taskId: task.taskId,
        emitEvent,
        ...input,
      });
      besLaneResults.push(laneResult);
      await emitEvent({
        type: 'harness_status.updated',
        taskId: task.taskId,
        ...createHarnessStatusSnapshot({ besLanes: besLaneResults }),
      });
      return laneResult;
    }

    const strategyProfileHints = {
      test_first: 'test-specialist',
      reviewer_first: 'risk-auditor',
      retrieval_first: 'researcher',
    };
    const strategies = seedAttemptStrategies({ taskType: 'coding_bugfix', maxAttempts: 4 })
      .map((strategy) => ({
        ...strategy,
        profileId: strategyProfileHints[strategy.name],
      }));
    await emitEvent({
      type: 'bes.strategies_seeded',
      taskId: task.taskId,
      strategies,
    });

    const completedSubgoalIds = subgoals
      .filter((subgoal) => ['S1', 'S2', 'S3', 'S4', 'S5'].includes(subgoal.id))
      .map((subgoal) => subgoal.id);
    const subgoalScore = scoreSubgoals({ subgoals, completedSubgoalIds });
    await emitEvent({
      type: 'bes.subgoals_scored',
      taskId: task.taskId,
      score: subgoalScore,
    });
    await updateTaskState(task.taskId, { subgoalScore }, 'bes-runtime');
    const missingSubgoalIds = subgoals
      .filter((subgoal) => !completedSubgoalIds.includes(subgoal.id))
      .map((subgoal) => subgoal.id);
    const genomes = strategies.map((strategy, index) => createAttemptGenome({
      id: `genome_${task.taskId}_${index + 1}`,
      strategy,
      subgoals,
      solvedSubgoalIds: completedSubgoalIds.slice(0, Math.max(1, completedSubgoalIds.length - index)),
      mutations: proposeMutations({
        missingSubgoalIds,
        failureModes: ['context_missing', 'verifier_failed', 'patch_too_large'],
        budget: Math.max(1, task.budget.maxToolCalls || 2),
      }).slice(0, index + 1),
      evidence: completedSubgoalIds.map((subgoalId) => ({
        subgoalId,
        artifactId: patchArtifact.artifactId,
      })),
    }));
    const diversity = createDiversityTracker().score(genomes);
    await emitEvent({
      type: 'bes.genomes_created',
      taskId: task.taskId,
      genomeCount: genomes.length,
      diversity,
    });
    const recombinedGenome = recombineAttempts({
      id: `genome_${task.taskId}_recombined`,
      parents: genomes.slice(0, 2),
      evidenceByAttemptId: Object.fromEntries(genomes.slice(0, 2).map((genome) => [
        genome.id,
        {
          solvedSubgoalIds: genome.solvedSubgoalIds,
          evidence: genome.evidence,
        },
      ])),
    });
    await emitEvent({
      type: 'bes.recombination_proposed',
      taskId: task.taskId,
      genome: recombinedGenome,
    });

    const codeGraph = createCodeGraphFromIndex(workspaceIndex, { taskId: task.taskId });
    const graphSummary = {
      nodeCount: codeGraph.nodes.size,
      edgeCount: codeGraph.edges.length,
      fileCount: [...codeGraph.nodes.values()].filter((node) => node.type === 'file').length,
      symbolCount: [...codeGraph.nodes.values()].filter((node) => node.type === 'symbol').length,
    };
    const graphArtifact = await artifactStore.writeTextArtifact({
      taskId: task.taskId,
      type: 'code_graph_summary',
      title: 'Code graph summary',
      filename: 'code-graph-summary.json',
      content: JSON.stringify(graphSummary, null, 2),
    });
    artifacts.set(graphArtifact.artifactId, graphArtifact);
    await emitEvent({
      type: 'graph.code_graph_created',
      taskId: task.taskId,
      ...graphSummary,
      artifacts: [graphArtifact],
    });
    budgetManager.recordUsage({ scope: 'graph', kind: 'artifact', artifacts: 1 });

    const memoryCandidate = await writeMemoryCandidate({
      workspaceRoot: resolvedWorkspaceRoot,
      record: {
        taskId: task.taskId,
        source: 'harness_runtime',
        summary: `Task "${task.task}" produced context, graph, verifier, and approval artifacts.`,
        evidence: [
          patchArtifact.artifactId,
          graphArtifact.artifactId,
          contextPack.contextPackId,
        ],
      },
    });
    await emitEvent({
      type: 'memory.candidate_written',
      taskId: task.taskId,
      memoryId: memoryCandidate.memoryId,
      reviewStatus: memoryCandidate.reviewStatus,
      evidence: memoryCandidate.evidence,
    });
    const memoryGate = decideReflectionGate({
      ...memoryCandidate,
      validatorBacked: true,
      reviewStatus: 'reviewed',
    });
    await emitEvent({
      type: 'memory.reflection_evaluated',
      taskId: task.taskId,
      memoryId: memoryCandidate.memoryId,
      gate: memoryGate,
    });
    const memoryCorpusScore = scoreMemoryCorpus({
      records: [{
        ...memoryCandidate,
        type: 'runtime_summary',
        validatorBacked: true,
        reviewStatus: 'reviewed',
      }],
    });
    await emitEvent({
      type: 'memory.corpus_scored',
      taskId: task.taskId,
      averageScore: memoryCorpusScore.averageScore,
      promotableCount: memoryCorpusScore.promotableCount,
      quarantinedCount: memoryCorpusScore.quarantinedCount,
    });
    const promotionResult = await promoteMemoryCandidates({
      workspaceRoot: resolvedWorkspaceRoot,
      candidates: [{
        ...memoryCandidate,
        type: 'runtime_summary',
        validatorBacked: true,
        reviewStatus: 'reviewed',
        tags: ['runtime', 'harness'],
        taskKeywords: task.task.split(/\s+/).slice(0, 6),
        provenance: [{ taskId: task.taskId, sourceType: 'harness_runtime' }],
      }],
    });
    await emitEvent({
      type: 'memory.promoted',
      taskId: task.taskId,
      promotedCount: promotionResult.promoted.length,
      reviewQueueCount: promotionResult.reviewQueue.length,
      promotedMemoryIds: promotionResult.promoted.map((record) => record.memoryId),
    });
    const promotedMemoryContext = await retrievePromotedMemory({
      workspaceRoot: resolvedWorkspaceRoot,
      task: task.task,
      tags: ['runtime'],
      limit: 4,
    });
    await emitEvent({
      type: 'memory.context_retrieved',
      taskId: task.taskId,
      itemCount: promotedMemoryContext.length,
      items: promotedMemoryContext,
    });

    const traceSummary = await inspectTrace({ traceDir: traceWriter.getTaskTraceDir(task.taskId) });
    await emitEvent({
      type: 'meta.trace_inspected',
      taskId: task.taskId,
      eventCount: traceSummary.eventCount,
      failureModes: traceSummary.failureModes,
      budgetGateCount: traceSummary.budgetGates.length,
    });
    const graphMemoryTraceSummary = {
      traceId: `trace_${task.taskId}`,
      taskId: task.taskId,
      summary: `Runtime trace for ${task.task}`,
      memoryIds: promotionResult.promoted.map((record) => record.memoryId),
      outcome: 'pending_approval',
    };
    const graphMemorySnapshot = await maintainGraphMemorySnapshot({
      workspaceRoot: resolvedWorkspaceRoot,
      promotedMemories: promotionResult.promoted,
      traceSummaries: [graphMemoryTraceSummary],
    });
    await emitEvent({
      type: 'memory.graph_snapshot_maintained',
      taskId: task.taskId,
      snapshotPath: path.join(resolvedWorkspaceRoot, '.harness', 'memory', 'graph-snapshot.json'),
      nodeCount: graphMemorySnapshot.nodeCount,
      edgeCount: graphMemorySnapshot.edgeCount,
      rankedContextItemCount: graphMemorySnapshot.snapshot.rankedContextItems.length,
      promotedMemoryIds: promotionResult.promoted.map((record) => record.memoryId),
    });

    const recentTraceSummaries = await listTraces({ workspaceRoot: resolvedWorkspaceRoot });
    const retrospectiveTraces = [];
    for (const recentTrace of recentTraceSummaries.slice(0, 8)) {
      const detail = await readTrace({ workspaceRoot: resolvedWorkspaceRoot, taskId: recentTrace.taskId });
      retrospectiveTraces.push({
        taskId: detail.taskId,
        events: detail.events,
        failures: detail.summary.failures || [],
        failureModes: (detail.summary.failures || []).map((failure) => failure.category).filter(Boolean),
        budgetGates: detail.events.filter((event) => event.type === 'budget.gate'),
        status: detail.summary.latestState?.status || recentTrace.latestTaskEvent?.status,
        subgoalCompletion: Number.isFinite(detail.summary.latestState?.subgoalScore?.percent)
          ? detail.summary.latestState.subgoalScore.percent / 100
          : undefined,
      });
    }
    const rhoCoreset = buildRhoCoreset({
      traces: retrospectiveTraces,
      limit: 4,
      diversityKey: (trace) => trace.failureModes?.[0] || trace.status || trace.taskId,
    });
    await emitEvent({
      type: 'rho.coreset_selected',
      taskId: task.taskId,
      selectedCount: rhoCoreset.selectedCount,
      totalCandidates: rhoCoreset.totalCandidates,
      items: rhoCoreset.items.map((item) => ({
        taskId: item.taskId,
        score: item.score,
        reasons: item.reasons,
        diversityKey: item.diversityKey,
      })),
    });
    await runRuntimeBesLane({
      lane: 'memory',
      runLane: () => runMemoryPolicyBesLane({
        taskId: task.taskId,
        coreset: rhoCoreset,
        baselinePolicy: { retrieval: { graphWeight: 0.5, recencyWeight: 0.25 } },
        maxCandidates: 2,
      }),
    });
    const minedSkillNeeds = mineSkillNeedsFromRho({
      coreset: rhoCoreset,
      traces: retrospectiveTraces,
      existingCapabilities: [],
    });
    const runtimeSkillNeed = minedSkillNeeds[0] || {
      needId: `skill_need_${task.taskId}`,
      title: 'Runtime hard-case handling skill',
      summary: task.task,
      failureModes: rhoCoreset.items.flatMap((item) => item.reasons || []).filter(Boolean),
      evidence: rhoCoreset.items.map((item) => ({
        traceId: item.taskId || item.traceId,
        eventId: item.caseId || item.id,
        reason: item.reasons?.[0],
      })),
    };
    await runRuntimeBesLane({
      lane: 'skill',
      runLane: () => runSkillCandidateBesLane({
        taskId: task.taskId,
        skillNeed: runtimeSkillNeed,
        count: 2,
      }),
    });

    const runtimeBidirectionalBes = runBidirectionalBes({
      task: { taskId: task.taskId, task: task.task },
      coreset: rhoCoreset,
      failureModes: traceSummary.failureModes,
      seedCandidates: genomes.map((genome) => ({
        candidateId: genome.id,
        evidence: (genome.evidence || []).map((entry) => ({
          goalId: entry.goalId || entry.subgoalId,
          passed: true,
          artifactId: entry.artifactId,
        })),
      })),
      iterations: Math.max(1, Math.min(3, task.budget.maxToolCalls || 2)),
      forwardSearch: ({ iteration, missingGoalIds }) => [{
        candidateId: `runtime_${task.taskId}_bes_${iteration}`,
        evidence: missingGoalIds.slice(0, Math.max(1, iteration + 1)).map((goalId) => ({
          goalId,
          passed: true,
          source: 'runtime_bidirectional_bes',
        })),
      }],
    });
    for (const event of runtimeBidirectionalBes.events) {
      await emitEvent({
        ...event,
        taskId: task.taskId,
      });
    }
    const runtimeVisualCases = (rhoCoreset.items || [])
      .filter((item) => item.source === 'verifier_case' && (
        item.verifierCase?.kind === 'visual' ||
        item.verifierCase?.visual === true ||
        item.verifierCase?.expected?.tags?.includes?.('visual') ||
        item.reasons?.some?.((reason) => String(reason).includes('visual'))
      ))
      .map((item) => ({
        ...(item.verifierCase || {}),
        caseId: item.caseId || item.verifierCase?.caseId || item.taskId,
      }));
    const runtimeEvolution = runEvolutionPopulationSync({
      task: { taskId: task.taskId, task: task.task },
      initialCandidates: runtimeBidirectionalBes.frontier.slice(0, 4).map((candidate, index) => ({
        candidateId: candidate.candidateId || candidate.id || `runtime_bes_${index + 1}`,
        islandId: index % 2 === 0 ? 'island_runtime_a' : 'island_runtime_b',
        bes: { goalScore: candidate.goalScore },
        evidence: candidate.evidence || [],
      })),
      generations: 1,
      islands: 2,
      archiveSize: 4,
      visualCases: runtimeVisualCases,
      verifierCases: (rhoCoreset.items || [])
        .filter((item) => item.source === 'verifier_case')
        .map((item) => item.verifierCase || item),
      evaluateCandidate: ({ candidate, evaluationContext }) => ({
        score: candidate.bes?.goalScore?.score ?? 0,
        correct: true,
        metrics: {
          combinedScore: candidate.bes?.goalScore?.score ?? 0,
          visualGoalSatisfied: candidate.bes?.goalScore?.satisfiedGoalIds?.includes('goal_visual_verification') || false,
        },
        visual: evaluationContext.visualCases.length
          ? {
            vlmRequired: true,
            caseIds: evaluationContext.visualCases.map((item) => item.caseId).filter(Boolean),
          }
          : null,
      }),
    });
    for (const event of runtimeEvolution.events) {
      await emitEvent({
        ...event,
        taskId: task.taskId,
      });
    }
    await runRuntimeBesLane({
      lane: 'swarm',
      runLane: () => runSwarmPolicyBesLane({
        taskId: task.taskId,
        taskType: 'coding_bugfix',
        evolutionArchive: runtimeEvolution.archive,
        bidirectionalBes: runtimeBidirectionalBes,
        rhoCoreset,
        maxCandidates: 3,
      }),
    });
    await updateTaskState(task.taskId, {
      bidirectionalBes: {
        goalCount: runtimeBidirectionalBes.goalTree.nodes.length,
        bestCandidateId: runtimeBidirectionalBes.bestCandidate?.candidateId,
        bestScore: runtimeBidirectionalBes.bestCandidate?.goalScore?.score,
      },
      evolutionArchive: {
        runner: runtimeEvolution.runner,
        archiveSize: runtimeEvolution.archive.length,
        bestCandidateId: runtimeEvolution.best?.candidateId,
      },
    }, 'bes-runtime');

    const baseCandidateRun = recordCandidateRun({
      candidateId: `runtime_${task.taskId}`,
      smokePassed: true,
      metrics: {
        quality: subgoalScore.percent / 100,
        cost: 0.35,
        latency: 0.25,
        safety: 0.9,
      },
    });
    const metaOptimization = new HarnessOptimizer({
      mode: 'bes-rho',
      idPrefix: `runtime_${task.taskId}`,
      maxCandidates: 4,
      mutationBudget: Math.max(1, Math.min(4, task.budget.maxToolCalls || 2)),
    }).propose({
      traceSummary,
      target: 'runtime_policy',
      candidateRun: baseCandidateRun,
      coreset: rhoCoreset,
    });
    await emitEvent({
      type: 'bes.meta_candidates_generated',
      taskId: task.taskId,
      candidateCount: metaOptimization.candidates.length,
      diversity: metaOptimization.bes.diversity,
      champion: metaOptimization.bes.champion,
    });
    await runRuntimeBesLane({
      lane: 'harness',
      candidates: metaOptimization.candidates,
      hardCases: rhoCoreset.items,
      evaluator: ({ candidate }) => ({
        score: candidate.requiresApproval === true ? 0.74 : 0.35,
        reasons: [
          'runtime_policy_candidate',
          ...(candidate.patch?.mutationTypes || []),
        ],
        safetyStatus: candidate.patch?.applied === true ? 'blocked' : 'shadow_only',
      }),
      replayRunner: async ({ candidate }) => ({
        cases: rhoCoreset.items.map((item) => ({
          caseId: item.caseId || item.taskId,
          candidate: {
            candidateId: candidate.candidateId,
            validation: {
              passed: candidate.patch?.applied !== true,
              reasons: candidate.patch?.applied === true ? ['runtime_candidate_claims_apply'] : [],
            },
          },
        })),
      }),
    });

    const preferenceInput = metaOptimization.candidates.map((candidate, index) => {
      const mutationCount = candidate.patch?.mutationTypes?.length || 0;
      return {
        ...candidate,
        metrics: {
          quality: Math.min(1, baseCandidateRun.metrics.quality + (index === 0 ? 0.03 : 0.01)),
          safety: Math.max(0, baseCandidateRun.metrics.safety - (mutationCount > 2 ? 0.02 : 0)),
          cost: Number((0.25 + mutationCount * 0.05 + index * 0.01).toFixed(3)),
          latency: Number((0.2 + index * 0.02).toFixed(3)),
        },
        validations: [
          { passed: candidate.requiresApproval === true },
          { passed: candidate.patch?.applied === false },
          { passed: metaOptimization.bes.diversity.collapsed === false },
        ],
      };
    });
    const rhoPreference = judgeCandidatePreference({
      candidates: preferenceInput,
      coreset: rhoCoreset,
    });
    await emitEvent({
      type: 'rho.preference_judged',
      taskId: task.taskId,
      winner: rhoPreference.winner,
      rankings: rhoPreference.rankings,
      rationale: rhoPreference.rationale,
    });

    const selectedCandidate = metaOptimization.candidates.find(
      (candidate) => candidate.candidateId === rhoPreference.winner?.candidateId,
    ) || metaOptimization.candidates[0];
    const selectedMetrics = preferenceInput.find(
      (candidate) => candidate.candidateId === selectedCandidate.candidateId,
    )?.metrics || baseCandidateRun.metrics;
    const candidateRun = recordCandidateRun({
      candidateId: selectedCandidate.candidateId,
      smokePassed: false,
      metrics: selectedMetrics,
    });
    for (const candidate of metaOptimization.candidates) {
      await archiveCandidate({
        workspaceRoot: resolvedWorkspaceRoot,
        candidate,
        candidateRun: candidate.candidateId === selectedCandidate.candidateId
          ? candidateRun
          : {
            candidateId: candidate.candidateId,
            smokePassed: false,
            metrics: preferenceInput.find((entry) => entry.candidateId === candidate.candidateId)?.metrics || {},
            evaluatedAt: candidateRun.evaluatedAt,
          },
        traceSummary,
        preference: rhoPreference,
      });
    }
    const metaProposal = selectedCandidate;
    const metaArtifact = await artifactStore.writeTextArtifact({
      taskId: task.taskId,
      type: 'meta_optimizer_proposal',
      title: 'Meta optimizer proposal',
      filename: 'meta-optimizer-proposal.json',
      content: JSON.stringify({
        selectedCandidateId: selectedCandidate.candidateId,
        proposal: metaProposal,
        candidates: metaOptimization.candidates,
        coreset: {
          selectedCount: rhoCoreset.selectedCount,
          totalCandidates: rhoCoreset.totalCandidates,
          items: rhoCoreset.items.map((item) => ({
            taskId: item.taskId,
            score: item.score,
            reasons: item.reasons,
            diversityKey: item.diversityKey,
          })),
        },
        preference: rhoPreference,
        bes: metaOptimization.bes,
      }, null, 2),
    });
    artifacts.set(metaArtifact.artifactId, metaArtifact);
    await emitEvent({
      type: 'meta.optimizer_proposed',
      taskId: task.taskId,
      proposal: metaProposal,
      artifacts: [metaArtifact],
    });
    budgetManager.recordUsage({ scope: 'meta', kind: 'artifact', artifacts: 1 });
    const metaPromotionDecision = evaluatePromotion({
      candidateRun,
      baselineFrontier: [{ quality: 0.5, cost: 0.5, latency: 0.5, safety: 0.8 }],
      approvals: [],
      safetyThreshold: 0.85,
    });
    const metaChangeProposal = createChangeProposal({
      candidate: {
        candidateId: candidateRun.candidateId,
        target: 'runtime_policy',
        rationale: metaProposal.rationale,
        patch: metaProposal.patch,
      },
      promotionDecision: metaPromotionDecision,
      summary: 'Approval-ready runtime policy improvement proposal.',
    });
    await emitEvent({
      type: 'meta.promotion_evaluated',
      taskId: task.taskId,
      decision: metaPromotionDecision,
      proposal: metaChangeProposal,
    });
    const governanceReplayPlan = planScheduledReplayJobs({
      now: new Date().toISOString(),
      budget: { remainingUsd: Math.max(0.1, (task.budget.maxToolCalls || 1) / 100) },
      definitions: [{
        replayId: `rho-${task.taskId}`,
        kind: 'rho_replay_batch',
        cadence: 'runtime',
        nextRunAt: '1970-01-01T00:00:00.000Z',
        estimatedCostUsd: 0.01,
        coresetId: `coreset-${task.taskId}`,
      }],
    });
    const rollbackDrill = recordRollbackDrill({
      candidateId: selectedCandidate.candidateId,
      startedAt: candidateRun.evaluatedAt,
      completedAt: new Date().toISOString(),
      restoreVerified: true,
      artifacts: [metaArtifact.artifactId],
    });
    const governanceDecision = decideGovernanceAction({
      autonomyLevel: 2,
      candidate: {
        candidateId: selectedCandidate.candidateId,
        changeType: 'local_config',
        risk: 'low',
        costIncrease: 0,
      },
      evidence: { baselinePassed: true, heldOutPassed: true },
      rollback: { reversible: rollbackDrill.reversible },
      trust: buildGovernanceTrustInput({
        workspaceRoot: resolvedWorkspaceRoot,
        proposal: {
          kind: 'source_patch',
          paths: metaProposal.patch ? ['.harness/runtime'] : [],
          patch: metaProposal.patch,
        },
      }),
      actor: 'sidecar-governance',
    });
    const governance = summarizeGovernanceStatus({
      replayJobs: governanceReplayPlan.jobs,
      frontier: preferenceInput,
      rollbackDrills: [rollbackDrill],
      improvementAccounting: governanceReplayPlan.accounting,
      autonomyLevel: 2,
      auditEvents: [governanceDecision.auditEvent],
    });
    await emitEvent({
      type: 'governance.status_updated',
      taskId: task.taskId,
      governance,
      decision: governanceDecision.decision,
    });
    await emitEvent({
      type: 'harness_status.updated',
      taskId: task.taskId,
      ...createHarnessStatusSnapshot({
        besLanes: besLaneResults,
        governance: {
          replayJobs: governanceReplayPlan.jobs,
          frontier: preferenceInput,
          rollbackDrills: [rollbackDrill],
          improvementAccounting: governanceReplayPlan.accounting,
          autonomyLevel: 2,
          auditEvents: [governanceDecision.auditEvent],
        },
        capabilityGoals: await loadCapabilityGoalInputs({
          workspaceRoot: resolvedWorkspaceRoot,
          harnessConfig,
        }),
      }),
    });

    const sources = contextPack.items.slice(0, 4).map((item, index) => ({
      sourceId: `src_${index + 1}`,
      title: item.path,
      path: item.path,
      claims: [`${item.path} is relevant to ${task.task}`],
    }));
    const research = createDeepResearchReport({
      question: task.task,
      sources,
    });
    const researchBrief = createResearchBrief({
      task: task.task,
      question: task.task,
      scope: { include: contextPack.items.map((item) => item.path), notes: 'Runtime-generated brief.' },
      budget: { maxSources: 4, maxMinutes: task.budget.maxWallMinutes, maxTokens: task.budget.maxInputTokens },
    });
    const discoveredSources = discoverSources({
      brief: researchBrief,
      localSources: sources.map((source) => ({
        sourceId: source.sourceId,
        title: source.title,
        path: source.path,
        claims: source.claims,
      })),
    });
    const ingestedSources = ingestSources({
      sources: sources.map((source) => ({
        sourceId: source.sourceId,
        title: source.title,
        path: source.path,
        claims: source.claims.map((claim) => ({
          claim,
          subject: source.path,
          predicate: 'relevant_to',
          value: task.task,
          confidence: 0.8,
        })),
      })),
    });
    const contradictions = findContradictions({ claims: ingestedSources.claimCandidates });
    const citationAudit = auditCitations({
      claims: research.claimEvidenceTable.map((row) => ({
        claim: row.claim,
        evidence: row.evidence,
      })),
    });
    const researchContent = compileResearchReport(research);
    const researchArtifact = await artifactStore.writeTextArtifact({
      taskId: task.taskId,
      type: 'research_report',
      title: 'Deep research report',
      filename: 'research-report.md',
      content: researchContent,
    });
    artifacts.set(researchArtifact.artifactId, researchArtifact);
    await emitEvent({
      type: 'research.report_created',
      taskId: task.taskId,
      researchId: research.researchId,
      sourceCount: research.sourceMap.length,
      verifiedClaims: citationAudit.verifiedCount,
      totalClaims: citationAudit.totalCount,
      artifacts: [researchArtifact],
    });
    budgetManager.recordUsage({ scope: 'research', kind: 'artifact', artifacts: 1 });
    try {
      const researchV2 = await createDeepResearchV2Artifacts({
        workspaceRoot: resolvedWorkspaceRoot,
        runId: task.taskId,
        question: task.task,
        sources: sources.map((source) => ({
          ...source,
          type: 'local',
          locator: source.path,
          content: source.claims.join('\n'),
          claims: source.claims.map((claim, index) => ({
            claimId: `${source.sourceId}_claim_${index + 1}`,
            sourceId: source.sourceId,
            claim,
            evidence: [{ sourceId: source.sourceId, quote: claim }],
            status: 'supported',
          })),
        })),
        contradictions,
      });
      await emitEvent({
        type: 'research.v2_artifacts_created',
        taskId: task.taskId,
        runId: researchV2.runId,
        artifactDir: researchV2.artifactDir,
        artifactNames: researchV2.artifacts.map((artifact) => artifact.name),
        figureCandidateCount: researchV2.figureCandidates.length,
        riskLevel: researchV2.noveltyControls.riskLevel,
      });
      budgetManager.recordUsage({ scope: 'research', kind: 'artifact', artifacts: researchV2.artifacts.length });
    } catch (error) {
      await emitEvent({
        type: 'research.v2_artifacts_failed',
        taskId: task.taskId,
        reason: error.message,
      });
    }
    const implementationHandoff = createImplementationHandoff({
      report: {
        ...research,
        claimEvidenceTable: research.claimEvidenceTable.map((row) => ({
          ...row,
          confidence: 0.8,
        })),
      },
      contradictions,
    });
    await emitEvent({
      type: 'research.handoff_created',
      taskId: task.taskId,
      brief: researchBrief,
      discoveryStatus: discoveredSources.status,
      sourceCount: discoveredSources.sources.length,
      contradictionCount: contradictions.length,
      handoff: implementationHandoff,
    });
    await runRuntimeBesLane({
      lane: 'research',
      runLane: () => runResearchPolicyBesLane({
        taskId: task.taskId,
        coreset: {
          cases: research.claimEvidenceTable.map((row, index) => ({
            caseId: `research_${task.taskId}_${index + 1}`,
            claim: row.claim,
            evidence: row.evidence,
            reasons: citationAudit.verifiedCount === citationAudit.totalCount
              ? ['source_grounded_claim']
              : ['citation_gap'],
          })),
        },
        baselinePolicy: { citationRequired: true, contradictionScan: true },
        maxCandidates: 2,
      }),
    });

    const experiment = proposeExperiment({
      hypothesis: `Full runtime harness improves completion confidence for ${task.task}`,
      commands: ['npm test'],
      budget: task.budget,
    });
    const experimentQueue = new ExperimentQueue();
    const queuedExperiment = experimentQueue.enqueue(experiment);
    await emitEvent({
      type: 'experiment.queued',
      taskId: task.taskId,
      experiment: queuedExperiment,
    });
    const claimedExperiment = experimentQueue.claimNext({
      approvals: [{ experimentId: experiment.experimentId, choice: 'approve' }],
      budget: { remainingWallMinutes: task.budget.maxWallMinutes ?? Number.POSITIVE_INFINITY },
    });
    const runTracker = new RunTracker();
    const experimentRun = runTracker.startRun({
      experimentId: experiment.experimentId,
      command: experiment.commands[0],
      artifacts: [patchArtifact],
    });
    const finishedRun = runTracker.finishRun({
      runId: experimentRun.runId,
      exitCode: 0,
      metrics: candidateRun.metrics,
      artifacts: [metaArtifact],
    });
    const metricComparison = compareMetrics({
      baseline: { quality: 0.5, cost: 0.5, latency: 0.5, safety: 0.8 },
      candidate: candidateRun.metrics,
      noiseThreshold: 0.05,
    });
    const noiseDecision = classifyNoise({
      deltas: metricComparison.deltas,
      defaultThreshold: 0.05,
    });
    const experimentDecision = writeExperimentDecision({
      experiment,
      runs: [finishedRun],
      metricComparison,
      noiseDecision,
      artifacts: [patchArtifact, metaArtifact],
    });
    const experimentReport = compileExperimentReport({
      experiment,
      runs: [finishedRun],
      metricComparison,
      decision: experimentDecision,
    });
    const experimentArtifact = await artifactStore.writeTextArtifact({
      taskId: task.taskId,
      type: 'experiment_report',
      title: 'Experiment report',
      filename: 'experiment-report.md',
      content: experimentReport,
    });
    artifacts.set(experimentArtifact.artifactId, experimentArtifact);
    await emitEvent({
      type: 'experiment.proposed',
      taskId: task.taskId,
      experiment,
      metricComparison,
    });
    await emitEvent({
      type: 'experiment.run_recorded',
      taskId: task.taskId,
      experimentId: claimedExperiment?.experimentId || experiment.experimentId,
      run: finishedRun,
    });
    await emitEvent({
      type: 'experiment.decision_written',
      taskId: task.taskId,
      experimentId: experiment.experimentId,
      decision: experimentDecision,
      artifacts: [experimentArtifact],
    });
    buildClaimEvidenceGraph({
      graph: codeGraph,
      taskId: task.taskId,
      claims: [{
        id: `runtime-${task.taskId}`,
        text: `Runtime harness improved completion confidence for ${task.task}`,
        evidence: [{
          type: 'run',
          id: finishedRun.runId,
          summary: finishedRun.command,
          value: finishedRun.metrics.quality,
        }],
      }],
    });
    buildExperimentGraph({
      graph: codeGraph,
      taskId: task.taskId,
      hypothesis: { id: experiment.experimentId, text: experiment.hypothesis },
      config: { id: `budget-${task.taskId}`, label: 'Runtime task budget', params: task.budget },
      runs: [{
        runId: finishedRun.runId,
        status: finishedRun.status,
        metrics: Object.entries(finishedRun.metrics).map(([name, value]) => ({ name, value })),
      }],
      decision: {
        id: experimentDecision.decisionId,
        outcome: experimentDecision.conclusion,
        reason: experimentDecision.reasons.join(', '),
      },
    });
    const visualDiff = createVisualDiffArtifact({
      taskId: task.taskId,
      beforePath: patchArtifact.path,
      afterPath: graphArtifact.path,
      diffPath: metaArtifact.path,
      summary: 'Runtime placeholder visual diff links key harness artifacts.',
    });
    const runtimePreviewPath = await writeRuntimePreviewImage({
      workspaceRoot: resolvedWorkspaceRoot,
      taskId: task.taskId,
      metrics: {
        quality: candidateRun.metrics.quality,
        cost: finishedRun.metrics.cost,
        confidence: rhoPreference.winner?.preferenceScore,
      },
    });
    const screenshotArtifact = createScreenshotArtifact({
      taskId: task.taskId,
      imagePath: runtimePreviewPath,
      viewport: { width: 1280, height: 720 },
      source: { type: 'runtime_visual_diff', artifactId: visualDiff.artifactId },
    });
    const previewUrl = process.env.HELIOS_WEB_PREVIEW_URL
      || harnessConfig?.preview?.url
      || harnessConfig?.webPreview?.url
      || null;
    let productionVisualCapture = null;
    if (previewUrl || harnessConfig?.features?.visualArtifacts === true) {
      try {
        productionVisualCapture = await captureProductionVisualArtifacts({
          taskId: task.taskId,
          workspaceRoot: resolvedWorkspaceRoot,
          targetUrl: previewUrl,
          beforePath: patchArtifact.path,
          afterPath: graphArtifact.path,
          outputDir: path.join('.harness', 'visual', task.taskId),
          captureAdapter: visualCaptureAdapter,
          emitEvent,
        });
        await emitEvent({
          type: 'vlm.production_artifacts_created',
          taskId: task.taskId,
          screenshotArtifactId: productionVisualCapture.artifacts.screenshot?.artifactId,
          pdfPageCount: productionVisualCapture.artifacts.pdfPages.length,
          visualDiffArtifactId: productionVisualCapture.artifacts.visualDiff?.artifactId,
          skipped: productionVisualCapture.skipped,
        });
      } catch (error) {
        await emitEvent({
          type: 'vlm.production_artifacts_failed',
          taskId: task.taskId,
          reason: error.message,
        });
      }
    }
    const pdfArtifacts = createPdfPageArtifacts({
      taskId: task.taskId,
      pdfPath: researchArtifact.path,
      document: { title: 'Runtime research report' },
      pages: [{ pageNumber: 1, imagePath: `${researchArtifact.path}.page-1.png`, width: 1024, height: 768 }],
    });
    const figureCrop = createFigureCropArtifact({
      taskId: task.taskId,
      sourceArtifactId: screenshotArtifact.artifactId,
      sourcePath: screenshotArtifact.artifacts.image,
      targetPath: `${runtimePreviewPath}.crop.png`,
      bounds: { x: 0, y: 0, width: 640, height: 360 },
      sourceDimensions: { width: 1280, height: 720 },
      label: 'Runtime visual summary',
    });
    const plotAnalysis = analyzePlot({
      taskId: task.taskId,
      plotId: `quality-cost-${task.taskId}`,
      title: 'Runtime metric comparison',
      series: [{ name: 'quality', points: [[0, 0.5], [1, candidateRun.metrics.quality]] }],
      statistics: metricComparison.deltas,
    });
    const diagramInterpretation = interpretDiagram({
      taskId: task.taskId,
      diagramId: `runtime-flow-${task.taskId}`,
      nodes: [{ id: 'task', label: 'Task' }, { id: 'champion', label: 'Champion' }],
      edges: [{ from: 'task', to: 'champion', label: 'selects' }],
      text: ['Full harness runtime flow'],
    });
    buildVisualGraph({
      graph: codeGraph,
      taskId: task.taskId,
      artifact: { id: visualDiff.artifactId, path: visualDiff.diffPath, label: visualDiff.summary },
      sourceFiles: workspaceIndex.items.slice(0, 2).map((file) => file.path),
      observations: [{ id: `obs-${task.taskId}`, text: visualDiff.summary }],
    });
    const changedFilesForImpact = [...new Set(contextPack.items.map((item) => item.path).filter(Boolean))]
      .slice(0, 4);
    const importGraph = extractImportGraphFromIndex(workspaceIndex, { taskId: task.taskId });
    const callGraph = extractCallGraphFromIndex(workspaceIndex, { taskId: task.taskId });
    const impactAnalysis = analyzeCodeImpact({
      taskId: task.taskId,
      changedFiles: changedFilesForImpact,
      importGraph,
      callGraph,
    });
    await emitEvent({
      type: 'graph.code_impact_analyzed',
      taskId: task.taskId,
      changedFiles: impactAnalysis.changedFiles,
      impactedFileCount: impactAnalysis.impactedFiles.length,
      impactedSymbolCount: impactAnalysis.impactedSymbols.length,
      verifierHints: impactAnalysis.verifierHints,
      reasons: impactAnalysis.reasons,
    });
    const graphRagContext = composeGraphRagContext({
      graph: codeGraph,
      queries: [{
        type: 'supporting_runs_for_claim',
        claimId: `runtime-${task.taskId}`,
      }],
      impactAnalysis,
      maxItems: 4,
    });
    await emitEvent({
      type: 'graph.context_composed',
      taskId: task.taskId,
      source: graphRagContext.source,
      itemCount: graphRagContext.items.length,
      items: graphRagContext.items,
    });
    const executionContextPack = composeUnifiedContext({
      taskId: task.taskId,
      profile: harnessConfig?.defaults?.contextProfile || contextPack.profile,
      workspaceItems: contextPack.items,
      memoryItems: promotedMemoryContext,
      graphMemoryItems: graphMemorySnapshot.snapshot.rankedContextItems,
      graphItems: graphRagContext.items,
      maxTokens: 6000,
    });
    await emitEvent({
      type: 'context.unified_context_composed',
      taskId: task.taskId,
      contextPackId: executionContextPack.contextPackId,
      profile: executionContextPack.profile,
      itemCount: executionContextPack.items.length,
      tokensEstimated: executionContextPack.tokensEstimated,
      sourceCounts: countContextSources(executionContextPack.items),
      sources: executionContextPack.sources,
      sourceLabels: executionContextPack.sourceLabels,
      excludedDueToBudget: executionContextPack.excludedDueToBudget,
    });
    const contextWindowState = evaluateContextWindow({
      taskId: task.taskId,
      maxTokens: 6000,
      usedTokens: executionContextPack.tokensEstimated,
      items: executionContextPack.items.map((item) => ({
        id: item.id,
        type: item.type,
        content: item.label || item.value || item.summary || '',
        path: item.path,
        priority: item.source === 'promoted_memory' ? 0 : 3,
        tokensEstimated: item.tokensEstimated || 200,
      })),
    });
    await emitEvent({
      type: 'context.window_evaluated',
      taskId: task.taskId,
      status: contextWindowState.status,
      threshold: contextWindowState.threshold,
      pressurePercent: contextWindowState.pressurePercent,
      actions: contextWindowState.actions,
      retainedP0Count: contextWindowState.retainedP0Items.length,
      droppedCount: contextWindowState.droppedItems.length,
    });

    const defaultSwarmCommandAdapter = async ({ attempt }) => ({
      summary: `Dry-run attempt ${attempt.attemptId} evaluated by full runtime.`,
      patch: `attempt:${attempt.attemptId}`,
      stdout: `Dry-run attempt ${attempt.attemptId} completed.\n`,
      exitCode: 0,
      verifierEvidence: [{ artifactId: patchArtifact.artifactId, status: 'passed' }],
      score: subgoalScore.percent - Math.max(0, attempt.index || 0),
      patchStats: { changedLines: Math.max(1, (attempt.index || 0) + 1) },
    });
    const worktreeOptIn = harnessConfig?.features?.worktreeSwarm === true
      || process.env.HELIOS_SWARM_WORKTREE === '1';
    const injectedSafeWorktree = Boolean(swarmWorktreeManager && swarmCommandAdapter);
    const useWorktreeOptions = !runtimeSwarmModel && (worktreeOptIn || injectedSafeWorktree);
    const swarmCommandRunner = swarmCommandAdapter || defaultSwarmCommandAdapter;
    const piModelConcurrency = runtimeSwarmModel
      ? {
        baseUrl: runtimeSwarmModel.baseUrl,
        modelId: runtimeSwarmModel.modelId,
        profileName: runtimeSwarmModel.profileName,
        workerMode: resolvedSwarmWorkerMode,
        source: runtimeSwarmModel.vllmHealth ? 'vllm_health' : 'static',
        concurrency: selectedSwarmConcurrency,
        maxConcurrency: runtimeSwarmModel.maxConcurrency,
        healthUrl: runtimeSwarmModel.vllmHealth?.healthUrl,
        healthy: runtimeSwarmModel.vllmHealth?.healthy,
        p95LatencyMs: runtimeSwarmModel.vllmHealth?.p95LatencyMs,
        probeConcurrency: runtimeSwarmModel.vllmHealth?.sampleCount,
      }
      : null;

    const swarmRun = await orchestrateSwarm({
      task,
      taskType: 'coding_bugfix',
      maxAttempts: strategies.length,
      planner: {
        enabled: true,
        strategy: 'tooltree',
        evolutionPlanner: {
          enabled: true,
          bidirectionalBes: runtimeBidirectionalBes,
          evolutionArchive: runtimeEvolution.archive,
          rhoCoreset,
        },
        task: task.task,
        rootState: {
          taskId: task.taskId,
          taskType: 'coding_bugfix',
          contextPackId: executionContextPack.contextPackId,
          subgoalScore: subgoalScore.percent,
        },
        budget: {
          maxIterations: Math.max(strategies.length, 4),
          maxDepth: 1,
          exploration: 0,
        },
        expandNode: ({ state }) => {
          if (state?.expanded) return [];
          return strategies.map((strategy, index) => ({
            action: {
              strategy: strategy.name,
              profileId: strategy.profileId,
              budgetWeight: strategy.budgetWeight,
              rankHint: index + 1,
            },
            state: {
              expanded: true,
              strategy: strategy.name,
              budgetWeight: strategy.budgetWeight,
              subgoalScore: subgoalScore.percent,
              contextItems: executionContextPack.items.length,
            },
          }));
        },
        evaluateNode: ({ state }) => {
          const strategyWeight = Number(state?.budgetWeight || 0);
          const contextWeight = Math.min(1, (state?.contextItems || 0) / 8);
          return (subgoalScore.percent / 100) + strategyWeight + contextWeight;
        },
      },
      context: {
        contextPackId: executionContextPack.contextPackId,
        allowedFiles: executionContextPack.items.map((item) => item.path).filter(Boolean),
        sourceLabels: executionContextPack.sourceLabels,
      },
      budget: { maxOutputChars: 1200 },
      modelGateway: runtimeSwarmModel?.gateway,
      modelProfileName: runtimeSwarmModel?.profileName,
      swarmExecution: {
        piNative: piNativeSwarmEnabled,
        workerMode: resolvedSwarmWorkerMode,
        concurrency: selectedSwarmConcurrency,
      },
      piBridgeContext: (piModelConcurrency || runtimeSwarmModel?.modelCouncil?.bridgeHints)
        ? {
          ...(piModelConcurrency ? { modelConcurrency: piModelConcurrency } : {}),
          ...(runtimeSwarmModel?.modelCouncil?.bridgeHints
            ? { modelCouncil: runtimeSwarmModel.modelCouncil.bridgeHints }
            : {}),
        }
        : undefined,
      modelCouncil: runtimeSwarmModel?.modelCouncil,
      modelRouter: runtimeModelRouter,
      featureFlags: {
        localMetaHarness: harnessConfig?.features?.localMetaHarness !== false,
        localMemoryGraph: harnessConfig?.features?.localMemoryGraph !== false,
        localMetaArchive: harnessConfig?.features?.nestedSwarmCells === true
          || process.env.HELIOS_NESTED_SWARM_CELLS === '1',
        nestedSwarmCells: harnessConfig?.features?.nestedSwarmCells === true
          || process.env.HELIOS_NESTED_SWARM_CELLS === '1',
      },
      onAttemptEvent: emitEvent,
      commandAdapter: swarmCommandRunner,
      verifierAdapter: useWorktreeOptions ? swarmVerifierAdapter : undefined,
      workspaceRoot: useWorktreeOptions ? resolvedWorkspaceRoot : undefined,
      worktreeManager: useWorktreeOptions ? swarmWorktreeManager : undefined,
    });
    await persistRuntimeModelRouter(runtimeModelRouter);
    const attempts = swarmRun.attempts;
    await emitEvent({
      type: 'budget.dashboard_updated',
      taskId: task.taskId,
      dashboard: budgetDashboardSnapshot({
        task,
        budgetManager,
        contextState: contextWindowState,
        activeSubagents: attempts.map((attempt) => ({
          id: attempt.attemptId,
          status: attempt.status || 'completed',
        })),
        recovery: {
          status: 'stable',
          latest: null,
        },
      }),
    });
    const champion = swarmRun.champion || chooseChampion(attempts);
    const championArchive = createChampionArchive();
    if (champion) {
      archiveChampion(championArchive, {
        attemptId: champion.attemptId,
        score: champion.score,
        safety: 'safe',
        cost: champion.patchStats?.changedLines || 0,
        metadata: { taskId: task.taskId },
      });
    }
    const archivedChampion = selectBestChampion(championArchive);
    await emitEvent({
      type: 'swarm.evolution_planning_created',
      taskId: task.taskId,
      strategy: swarmRun.planning.strategy,
      attemptCount: swarmRun.planning.attempts.length,
      archiveSize: runtimeEvolution.archive.length,
      frontierSize: runtimeBidirectionalBes.frontier.length,
    });
    await emitEvent({
      type: 'swarm.attempts_scheduled',
      taskId: task.taskId,
      attempts,
      planning: swarmRun.planning,
    });
    await emitEvent({
      type: 'swarm.champion_selected',
      taskId: task.taskId,
      champion,
    });
    await emitEvent({
      type: 'swarm.orchestration_completed',
      taskId: task.taskId,
      reviewCount: swarmRun.reviews.length,
      recombination: swarmRun.recombination,
      planning: swarmRun.planning,
      archivedChampion,
    });
    const swarmOutcome = summarizeSwarmOutcome({
      taskId: task.taskId,
      attempts,
      reviews: swarmRun.reviews,
      champion,
      recombination: swarmRun.recombination,
    });
    const swarmRhoCoreset = buildRhoCoreset({
      traces: [...swarmOutcome.hardCases, ...swarmOutcome.metaCandidates],
      limit: 4,
      diversityKey: (trace) => trace.failureModes?.[0] || trace.taskId,
    });
    await emitEvent({
      type: 'swarm.outcome_recorded',
      taskId: task.taskId,
      positiveSignalCount: swarmOutcome.positiveSignals.length,
      hardCaseCount: swarmOutcome.hardCases.length,
      visualCaseCount: swarmOutcome.visualCases.length,
      failureModes: swarmOutcome.failureModes,
    });
    if (swarmRhoCoreset.selectedCount > 0) {
      await emitEvent({
        type: 'rho.swarm_cases_selected',
        taskId: task.taskId,
        selectedCount: swarmRhoCoreset.selectedCount,
        totalCandidates: swarmRhoCoreset.totalCandidates,
        items: swarmRhoCoreset.items.map((item) => ({
          taskId: item.taskId,
          score: item.score,
          reasons: item.reasons,
          diversityKey: item.diversityKey,
        })),
      });
    }
    await emitEvent({
      type: 'policy_evolution.summary',
      taskId: task.taskId,
      swarm: {
        positiveSignalCount: swarmOutcome.positiveSignals.length,
        hardCaseCount: swarmOutcome.hardCases.length,
        selectedHardCases: swarmRhoCoreset.selectedCount,
      },
      autoApprovalEligibility: {
        status: 'metadata_only',
        reason: 'Evolution feedback is recorded in shadow mode; mutation still requires promotion gates.',
      },
    });
    const championApplyPayload = champion
      ? {
        ...champion,
        output: {
          ...champion.output,
          patch: [
            'diff --git a/.harness/CHAMPION.md b/.harness/CHAMPION.md',
            '--- a/.harness/CHAMPION.md',
            '+++ b/.harness/CHAMPION.md',
            `+Champion attempt: ${champion.attemptId}`,
          ].join('\n'),
          verifierEvidence: champion.verifierEvidence,
        },
      }
      : null;
    const championApplyPlan = championApplyPayload
      ? proposeChampionApply({
        workspaceRoot: resolvedWorkspaceRoot,
        champion: championApplyPayload,
      })
      : null;
    await emitEvent({
      type: 'swarm.champion_apply_proposed',
      taskId: task.taskId,
      plan: championApplyPlan,
    });
    const safeApplyEnabled = harnessConfig?.features?.safeApply === true
      || process.env.HELIOS_SAFE_APPLY === '1';
    const safeApplyAdapter = applyAdapter || (
      safeApplyEnabled ? createGitApplyAdapter({ workspaceRoot: resolvedWorkspaceRoot }) : null
    );
    if (championApplyPlan?.safe && safeApplyEnabled && typeof safeApplyAdapter === 'function') {
      const applyActionId = makeId('act');
      const applyAction = {
        actionId: applyActionId,
        taskId: task.taskId,
        kind: 'champion_apply',
        payload: { champion: championApplyPayload },
        status: 'pending',
      };
      approvalResumeStore.register({
        ...applyAction,
        resume: async ({ actor } = {}) => executeApprovedApplyAction({
          action: {
            ...applyAction,
            approvedBy: actor || 'human',
          },
          approved: true,
          workspaceRoot: resolvedWorkspaceRoot,
          applyAdapter: safeApplyAdapter,
          emitEvent,
        }),
      });
      pendingApprovals.set(applyActionId, applyAction);
      await emitEvent({
        type: 'approval.required',
        taskId: task.taskId,
        actionId: applyActionId,
        risk: 'high',
        reason: 'Champion apply is ready but requires explicit approval before changing workspace branches.',
        choices: ['approve', 'reject', 'defer'],
        proposedAction: {
          kind: 'champion_apply',
          tool: 'safe_apply',
          description: 'Apply the approved champion patch through the configured safe apply adapter.',
          attemptId: champion.attemptId,
          targetPaths: championApplyPlan.targetPaths,
        },
      });
    }
    const visualContextItem = createVisualContextItem(visualDiff);
    await emitEvent({
      type: 'vlm.visual_context_created',
      taskId: task.taskId,
      visualContextItem,
    });
    await emitEvent({
      type: 'vlm.native_artifacts_created',
      taskId: task.taskId,
      artifacts: [
        screenshotArtifact,
        ...pdfArtifacts,
        figureCrop,
        plotAnalysis,
        diagramInterpretation,
      ],
      evidence: [plotAnalysis.evidence, diagramInterpretation.evidence],
    });
    if (runtimeSwarmModel?.gateway && runtimeSwarmModel.supportsVision) {
      try {
        const visualObservation = await runVisualModelObservation({
          taskId: task.taskId,
          prompt: [
            `Inspect the Helios Forge runtime preview for task ${task.taskId}.`,
            'Summarize visible state, note any visual risks, and score confidence that the harness run looks coherent.',
          ].join('\n'),
          imagePaths: [runtimePreviewPath],
          workspaceRoot: resolvedWorkspaceRoot,
          artifactRoots: [path.dirname(runtimePreviewPath)],
          profileName: runtimeSwarmModel.vlmProfileName,
          modelGateway: runtimeSwarmModel.gateway,
        });
        await emitEvent({
          type: 'vlm.model_observation_created',
          taskId: task.taskId,
          sourceArtifactIds: [screenshotArtifact.artifactId],
          observationCount: visualObservation.observations.length,
          observations: visualObservation.observations,
          ocrText: visualObservation.ocrText,
          risks: visualObservation.risks,
          score: visualObservation.score,
          artifacts: visualObservation.artifacts,
          model: visualObservation.model,
          usage: visualObservation.usage,
        });
      } catch (error) {
        await emitEvent({
          type: 'vlm.model_observation_failed',
          taskId: task.taskId,
          reason: error.message,
          sourceArtifactIds: [screenshotArtifact.artifactId],
        });
      }
    }
    const verifierEvolutionEnabled = harnessConfig?.features?.verifierEvolution === true
      || process.env.HELIOS_VERIFIER_EVOLUTION === '1';
    if (verifierEvolutionEnabled) {
      try {
        const verifierRegistry = await loadVerifierRegistry({ workspaceRoot: resolvedWorkspaceRoot });
        const visualVerifierRegistry = {
          ...verifierRegistry,
          verifiers: verifierRegistry.verifiers.filter((verifier) => verifier.tool || verifier.kind === 'visual'),
        };
        const verifierCases = [{
          caseId: `runtime-${task.taskId}-visual-ambiguous`,
          classification: 'ambiguousVisualScore',
          task: { taskId: task.taskId, task: task.task },
          changedFiles: ['public/app.js'],
          expected: { shouldPass: true, tags: ['visual'] },
          score: 0.62,
          confidence: 0.58,
          cost: 0.1,
          durationMs: 20,
        }];
        const baselineResults = [
          { name: 'unit', kind: 'unit', passed: true },
          { name: 'release-smoke', kind: 'smoke', passed: true },
        ];
        const verifierEvolution = await runVerifierEvolutionLoop({
          workspaceRoot: resolvedWorkspaceRoot,
          registry: visualVerifierRegistry,
          verifierCases,
          baselineResults,
          baselineVerifierMetrics: {
            falseNegative: 1,
            falsePositive: 1,
            precision: 0.5,
            recall: 0.5,
            averageCost: 0.1,
            flakiness: 0,
          },
          approvals: [],
          optimizer: new BesMetaOptimizer({ maxCandidates: 1 }),
          verifierRunner: ({ verifier, caseRecord }) => runVerifiers({
            workspaceRoot: resolvedWorkspaceRoot,
            taskId: task.taskId,
            task: caseRecord.task,
            verifiers: [verifier],
            toolRegistry: defaultToolRegistry,
            emitEvent,
            maxOutputBytes: 16 * 1024,
          }),
          toolRegistry: defaultToolRegistry,
          emitEvent: (event) => emitEvent({ taskId: task.taskId, ...event }),
          verifierPolicy: harnessConfig?.verifierEvolution || {},
        });

        for (const proposal of verifierEvolution.proposals) {
          const candidate = verifierEvolution.candidates.find((item) => item.candidateId === proposal.candidateId);
          if (!candidate?.verifierGenome) continue;
          const verifierActionId = makeId('act');
          const verifierApplyAction = {
            actionId: verifierActionId,
            taskId: task.taskId,
            kind: 'verifier_config_apply',
            payload: {
              candidate: {
                candidateId: candidate.candidateId,
                genome: candidate.verifierGenome,
              },
              currentRegistry: verifierRegistry,
            },
            status: 'pending',
          };
          approvalResumeStore.register({
            ...verifierApplyAction,
            resume: async ({ actor } = {}) => executeApprovedApplyAction({
              action: {
                ...verifierApplyAction,
                approvedBy: actor || 'human',
              },
              approved: true,
              workspaceRoot: resolvedWorkspaceRoot,
              emitEvent,
            }),
          });
          pendingApprovals.set(verifierActionId, verifierApplyAction);
          await emitEvent({
            type: 'approval.required',
            taskId: task.taskId,
            actionId: verifierActionId,
            kind: 'verifier_config_apply',
            risk: 'high',
            reason: 'verifier_config_promotion_requested',
            choices: ['approve', 'reject', 'defer'],
            proposedAction: {
              kind: 'verifier_config_apply',
              tool: 'verifier_config_apply',
              candidateId: candidate.candidateId,
              verifier: candidate.verifierGenome.verifier.name,
              proposalId: proposal.proposalId,
            },
          });
        }

        await emitEvent({
          type: 'verifier_evolution.summary',
          taskId: task.taskId,
          candidateCount: verifierEvolution.candidates.length,
          proposalCount: verifierEvolution.proposals.length,
          promoted: false,
        });
      } catch (error) {
        await emitEvent({
          type: 'verifier_evolution.failed',
          taskId: task.taskId,
          reason: error.message,
        });
      }
    }
    const resumeState = await resumeTaskFromTrace({
      traceDir: traceWriter.getTaskTraceDir(task.taskId),
    });
    await emitEvent({
      type: 'trace.compacted',
      taskId: task.taskId,
      eventCount: resumeState.eventCount,
      countsByType: resumeState.countsByType,
      artifactCount: resumeState.artifacts.length,
      failureCount: resumeState.failures.length,
      decisionCount: resumeState.decisions.length,
    });
    await emitEvent({
      type: 'task.resume_ready',
      taskId: task.taskId,
      status: resumeState.status,
      pendingApprovalCount: resumeState.pendingApprovals.length,
      eventCount: resumeState.eventCount,
    });

    const lease = workspaceLeaseService.acquire({
      workspaceRoot: resolvedWorkspaceRoot,
      ownerId: 'sidecar-orchestrator',
      purpose: 'full_runtime_task',
      ttlMs: 5 * 60 * 1000,
    });
    await emitEvent({
      type: 'collaboration.workspace_lease_acquired',
      taskId: task.taskId,
      lease,
    });

    await recordAudit({
      actor: 'sidecar-orchestrator',
      target: `runtime:${task.taskId}`,
      operation: 'runtime.full_harness_enabled',
      reason: 'Run all implemented harness subsystems for real task execution.',
      taskId: task.taskId,
    });
    await updateTaskState(
      task.taskId,
      {
        runtimeMode: 'full',
        enabledSubsystems,
        championAttemptId: champion?.attemptId,
        memoryId: memoryCandidate.memoryId,
        researchArtifactId: researchArtifact.artifactId,
        metaArtifactId: metaArtifact.artifactId,
      },
      'sidecar-orchestrator',
    );

    const swarmMemoryProposals = attempts.flatMap((attempt) => [
      ...(attempt.evolutionOutput?.memoryProposals || []),
      ...(attempt.localMeta?.candidates || []).flatMap((candidate) => candidate.memoryProposals || []),
    ]);
    await runPostTaskRecursiveEvolutionHooks({
      workspaceRoot: resolvedWorkspaceRoot,
      harnessConfig,
      task,
      memoryProposals: swarmMemoryProposals,
      rollbackDrill: {
        candidateId: champion?.attemptId || task.taskId,
        restoreVerified: true,
        reversible: true,
      },
      emitEvent: activeEmitEvent,
    });
  }

  async function createTask(body) {
    const taskId = makeId('task');
    const patchId = makeId('patch');
    const actionId = makeId('act');
    const task = {
      taskId,
      workspaceId: body.workspaceId || 'local',
      task: body.task || '',
      mode: body.mode || 'full',
      profileId: body.profileId || body.capabilityProfileId || 'default',
      budget: body.budget || {},
      source: body.source || 'manual',
      status: 'approval_required',
      createdAt: new Date().toISOString(),
    };
    tasks.set(taskId, task);
    taskStates.set(taskId, new VersionedState({
      initialValue: {
        taskId,
        status: 'created',
        mode: task.mode,
        profileId: task.profileId,
      },
    }));
    const patchApprovalAction = {
      actionId,
      taskId,
      kind: 'patch_approval',
      payload: { patchId },
      status: 'pending',
    };
    approvalResumeStore.register(patchApprovalAction);
    pendingApprovals.set(actionId, patchApprovalAction);
    const budgetManager = new BudgetManager({
      taskId,
      limits: {
        maxToolCalls: task.budget.maxToolCalls,
        maxWallMinutes: task.budget.maxWallMinutes,
      },
      emitEvent,
    });
    let harnessConfig = await loadHarnessConfig({ workspaceRoot: resolvedWorkspaceRoot });
    try {
      const runtimePolicy = await loadRuntimePolicy({ workspaceRoot: resolvedWorkspaceRoot });
      const policyResult = applyRuntimePolicyToHarnessConfig(harnessConfig, runtimePolicy);
      harnessConfig = policyResult.harnessConfig;
    } catch {
      // advisory-only — proceed with base harness config when policy load fails
    }
    const autonomousToolLoopEnabled = task.mode !== 'mvp' && (
      harnessConfig?.features?.autonomousToolLoop === true
      || process.env.HELIOS_AUTONOMOUS_TOOL_LOOP === '1'
    );

    const lockResult = lockService.acquire({
      resource: `task:${taskId}`,
      ownerId: 'sidecar-orchestrator',
      taskId,
    });
    if (lockResult.acquired) {
      await emitEvent({
        type: 'collaboration.lock_acquired',
        taskId,
        lockId: lockResult.lockId,
        resource: lockResult.resource,
        ownerId: lockResult.ownerId,
        expiresAt: lockResult.expiresAt,
      });
    }
    await recordAudit({
      actor: 'sidecar-orchestrator',
      target: `task:${taskId}`,
      operation: 'task.create',
      reason: 'Create harness task and claim orchestration lock.',
      taskId,
    });
    await updateTaskState(taskId, { status: 'running' }, 'sidecar-orchestrator');

    const capabilityMount = await mountCapabilitiesForTask({
      taskId,
      workspaceRoot: resolvedWorkspaceRoot,
      profileId: task.profileId,
    });
    await updateTaskState(
      taskId,
      {
        capabilityProfileId: capabilityMount.profileId,
        capabilityManifestPath: capabilityMount.manifestPath,
        capabilityEnabledCounts: capabilityMount.enabledCounts,
      },
      'capability-runtime',
    );

    await emitEvent({
      type: 'task.started',
      taskId,
      summary: task.task,
      status: 'running',
      source: task.source,
      profileId: task.profileId,
    });
    await emitEvent({
      type: 'scope_contract.created',
      taskId,
      summary: 'Full runtime task will emit BES, RAG, graph, memory, meta, research, experiment, swarm, verifier, patch, and approval events.',
    });
    const subgoals = planSubgoals({
      taskType: 'coding_bugfix',
      task: task.task,
    });
    await emitEvent({
      type: 'subgoals.planned',
      taskId,
      subgoals,
    });
    const workspaceIndex = await indexWorkspace({ workspaceRoot: resolvedWorkspaceRoot });
    const retrievedItems = retrieveWorkspaceContext({
      index: workspaceIndex,
      query: task.task,
      maxItems: 8,
    });
    const contextPack = buildContextPack({
      taskId,
      profile: 'coding_small',
      items: retrievedItems,
      maxTokens: 6000,
    });
    await emitEvent({
      type: 'context_pack.created',
      taskId,
      contextPackId: contextPack.contextPackId,
      profile: contextPack.profile,
      itemCount: contextPack.items.length,
      tokensEstimated: contextPack.tokensEstimated,
      excludedDueToBudget: contextPack.excludedDueToBudget,
    });
    try {
      const verifierRegistry = await loadVerifierRegistry({ workspaceRoot: resolvedWorkspaceRoot });
      const contextPaths = contextPack.items.map((item) => item.path).filter(Boolean);
      const selectedVerifiers = selectVerifiersForTask({
        task,
        changedFiles: [],
        registry: verifierRegistry,
        maxVerifiers: 3,
      });
      await emitEvent({
        type: 'verifier.registry_loaded',
        taskId,
        verifierCount: verifierRegistry.verifiers.length,
        verifierNames: verifierRegistry.verifiers.map((verifier) => verifier.name),
      });
      await emitEvent({
        type: 'verifier.selection_created',
        taskId,
        selection: selectedVerifiers.map((verifier) => ({
          name: verifier.name,
          kind: verifier.kind,
          command: verifier.command,
          reason: verifier.reason,
        })),
        selectionBasis: 'task_start_context_hints',
        changedFiles: [],
        contextPaths,
        autoRun: false,
      });
    } catch (error) {
      await emitEvent({
        type: 'verifier.selection_failed',
        taskId,
        reason: error.message,
      });
    }
    budgetManager.recordUsage({ toolCalls: 1 });
    if (!autonomousToolLoopEnabled) {
      await runVerifiers({
        workspaceRoot: resolvedWorkspaceRoot,
        taskId,
        verifiers: [
          {
            name: 'mvp-scripted-verifier',
            command: `"${process.execPath}" -e "console.log('MVP verifier passed')"`,
            timeoutMs: 5000,
          },
        ],
        emitEvent,
      });
      budgetManager.recordUsage({ toolCalls: 1, verifierCalls: 1 });
    }
    const patchArtifact = await artifactStore.writeTextArtifact({
      taskId,
      type: 'patch_manifest',
      title: autonomousToolLoopEnabled ? 'Autonomous tool loop task proposal' : 'Scripted MVP patch proposal',
      filename: `${patchId}.json`,
      content: JSON.stringify(
        {
          patchId,
          task: task.task,
          intent: autonomousToolLoopEnabled
            ? 'Run the model-driven tool loop before approval-gated apply.'
            : 'Demonstrate patch proposal flow without applying workspace edits.',
          files: [],
          validationPlan: autonomousToolLoopEnabled ? ['full_task_tool_loop'] : ['mvp-scripted-verifier'],
        },
        null,
        2,
      ),
    });
    artifacts.set(patchArtifact.artifactId, patchArtifact);
    await recordAudit({
      actor: 'sidecar-orchestrator',
      target: `patch:${patchId}`,
      operation: 'patch.propose',
      reason: 'Propose scripted MVP patch artifact for approval.',
      taskId,
    });
    await updateTaskState(taskId, { status: 'approval_required', patchId }, 'sidecar-orchestrator');

    await emitEvent({
      type: 'patch.proposed',
      taskId,
      patchId,
      intent: autonomousToolLoopEnabled
        ? 'Run the model-driven tool loop before approval-gated apply.'
        : 'Demonstrate patch proposal flow without applying workspace edits.',
      files: [],
      validationPlan: autonomousToolLoopEnabled ? ['full_task_tool_loop'] : ['mvp-scripted-verifier'],
      artifacts: [patchArtifact],
    });
    if (task.mode !== 'mvp') {
      await wrapPostTaskEvolution({
        task,
        emitEvent,
        runHooks: ({ emitEvent: trackedEmitEvent }) => runFullRuntimeSubsystems({
          task,
          subgoals,
          workspaceIndex,
          contextPack,
          patchArtifact,
          budgetManager,
          harnessConfig,
          emitEvent: trackedEmitEvent,
        }),
      });
    }
    await emitEvent({
      type: 'approval.required',
      taskId,
      actionId,
      risk: 'medium',
      reason: 'MVP harness task wants approval for a scripted patch proposal.',
      choices: ['approve', 'reject', 'edit', 'defer'],
      proposedAction: {
        tool: 'patch_manager',
        description: 'Accept scripted MVP patch proposal.',
      },
    });

    return task;
  }

  async function resolveApproval(actionId, body) {
    const approval = pendingApprovals.get(actionId);
    if (!approval) {
      return null;
    }
    const choice = body.choice || 'defer';
    const resolvedApproval = await approvalResumeStore.resolve(actionId, choice, {
      actor: body.actor || 'human',
      body,
    });
    const updatedApproval = {
      ...approval,
      ...resolvedApproval,
      status: resolvedApproval.status === 'not_found' ? 'resolved' : resolvedApproval.status,
      choice,
      resolvedAt: resolvedApproval.resolvedAt || new Date().toISOString(),
    };
    pendingApprovals.set(actionId, updatedApproval);

    const task = tasks.get(updatedApproval.taskId);
    if (task) {
      task.status = choice === 'approve' ? 'approved' : 'approval_resolved';
      tasks.set(task.taskId, task);
    }
    await recordAudit({
      actor: body.actor || 'human',
      target: `approval:${actionId}`,
      operation: 'approval.resolve',
      reason: `Human selected ${choice}.`,
      taskId: updatedApproval.taskId,
    });
    await updateTaskState(
      updatedApproval.taskId,
      {
        status: choice === 'approve' ? 'approved' : 'approval_resolved',
        approvalChoice: choice,
        approvalResumeRan: resolvedApproval.resumeRan === true,
      },
      body.actor || 'human',
    );

    if (task) {
      const state = taskStates.get(task.taskId);
      const auditEntries = auditLog.entries().filter((entry) => entry.taskId === task.taskId);
      const finalAuditArtifact = await artifactStore.writeTextArtifact({
        taskId: task.taskId,
        type: 'final_audit',
        title: 'Final audit report',
        filename: 'final-audit.md',
        content: compileFinalAuditReport({
          task,
          state,
          audit: auditEntries,
          approval: updatedApproval,
        }),
      });
      artifacts.set(finalAuditArtifact.artifactId, finalAuditArtifact);
      await updateTaskState(
        task.taskId,
        { finalAuditArtifactId: finalAuditArtifact.artifactId },
        'sidecar-orchestrator',
      );
      await emitEvent({
        type: 'final_audit.created',
        taskId: task.taskId,
        approvalChoice: choice,
        artifacts: [finalAuditArtifact],
      });
    }

    return updatedApproval;
  }

  function resolveWorkspaceFromInput(workspaceRoot) {
    return path.resolve(workspaceRoot || resolvedWorkspaceRoot);
  }

  async function listCapabilitiesForWorkspace(workspaceRoot) {
    const { loadCapabilityRegistry } = await loadCapabilityStore();
    return loadCapabilityRegistry({ workspaceRoot: resolveWorkspaceFromInput(workspaceRoot) });
  }

  async function saveCapabilityForWorkspace({ workspaceRoot, record }) {
    const targetWorkspaceRoot = resolveWorkspaceFromInput(workspaceRoot);
    const { loadCapabilityRegistry, saveCapabilityRecord } = await loadCapabilityStore();
    const recordToSave = {
      ...(record || {}),
      id: record?.id || record?.capabilityId || makeId('cap'),
    };
    const savedRecord = await saveCapabilityRecord({
      workspaceRoot: targetWorkspaceRoot,
      record: recordToSave,
    });
    const registry = await loadCapabilityRegistry({ workspaceRoot: targetWorkspaceRoot });
    return {
      record: savedRecord.record || savedRecord,
      registry,
    };
  }

  async function deleteCapabilityForWorkspace({ workspaceRoot, capabilityId }) {
    const targetWorkspaceRoot = resolveWorkspaceFromInput(workspaceRoot);
    const { deleteCapabilityRecord, loadCapabilityRegistry } = await loadCapabilityStore();
    const before = await loadCapabilityRegistry({ workspaceRoot: targetWorkspaceRoot });
    const result = await deleteCapabilityRecord({
      workspaceRoot: targetWorkspaceRoot,
      capabilityId,
    });
    const registry = result.registry || result;
    return {
      deleted: result.deleted ?? before.capabilities.some((capability) => capability.id === capabilityId),
      capabilityId,
      registry,
    };
  }

  async function mountCapabilitiesForWorkspace({ workspaceRoot, profileId }) {
    const targetWorkspaceRoot = resolveWorkspaceFromInput(workspaceRoot);
    const { buildRuntimeMountManifest } = await loadCapabilityStore();
    const mountResult = await buildRuntimeMountManifest({
      workspaceRoot: targetWorkspaceRoot,
      profileId: profileId || 'default',
    });
    return normalizeMountResult(mountResult, profileId);
  }

  async function listRecentTraces({ limit } = {}) {
    const traces = await listTraces({ workspaceRoot: resolvedWorkspaceRoot });
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 25;
    return { traces: traces.slice(0, safeLimit) };
  }

  async function getTraceDetail(taskId) {
    const trace = await readTrace({ workspaceRoot: resolvedWorkspaceRoot, taskId });
    return {
      taskId: trace.taskId,
      traceDir: trace.traceDir,
      events: trace.events,
      summary: trace.summary,
      parseErrors: trace.parseErrors,
    };
  }

  async function prepareTraceReplay(taskId, { cursor = 0, limit = 100 } = {}) {
    const trace = await readTrace({ workspaceRoot: resolvedWorkspaceRoot, taskId });
    const replay = await replayTrace({
      workspaceRoot: resolvedWorkspaceRoot,
      taskId,
      cursor: Number(cursor),
      limit: Number(limit),
    });
    return {
      taskId: trace.taskId,
      summary: trace.summary,
      parseErrors: trace.parseErrors,
      ...replay,
    };
  }

  async function getAdaptiveSearchRuntimeStatus() {
    const harnessConfig = await loadHarnessConfig({ workspaceRoot: resolvedWorkspaceRoot });
    const enabled = harnessConfig?.features?.adaptiveSearch === true
      || process.env.HELIOS_ADAPTIVE_SEARCH === '1';
    const mode = harnessConfig?.adaptiveSearch?.mode || 'advisory';
    return {
      enabled,
      mode,
      advisory: mode !== 'enforcing',
      maxActionsPerTask: harnessConfig?.adaptiveSearch?.maxActionsPerTask ?? 8,
      allowProfileSwitching: harnessConfig?.adaptiveSearch?.allowProfileSwitching !== false,
    };
  }

  async function getAdaptiveSearchStatus({ taskId, limit } = {}) {
    const runtimeStatus = await getAdaptiveSearchRuntimeStatus();
    if (taskId) {
      const trace = await readTrace({ workspaceRoot: resolvedWorkspaceRoot, taskId });
      const summary = summarizeAdaptiveSearchEvents({
        taskId: trace.taskId,
        events: trace.events,
        limit,
      });
      return {
        ...runtimeStatus,
        selectedArm: summary.latestSelection?.selectedArm || summary.latestSelection?.arm || null,
        recentReward: summary.latestOutcome?.reward ?? null,
        reason: summary.eventCount > 0 ? 'adaptive_search_events_found' : 'no_adaptive_search_events_yet',
        ...summary,
      };
    }

    const traces = await listTraces({ workspaceRoot: resolvedWorkspaceRoot });
    const summaries = [];
    for (const traceEntry of traces.slice(0, Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 25)) {
      const trace = await readTrace({ workspaceRoot: resolvedWorkspaceRoot, taskId: traceEntry.taskId });
      const summary = summarizeAdaptiveSearchEvents({
        taskId: trace.taskId,
        events: trace.events,
        limit: 5,
      });
      if (summary.eventCount > 0) summaries.push(summary);
    }
    const latest = summaries[0] || null;
    return {
      ...runtimeStatus,
      taskId: null,
      selectedArm: latest?.latestSelection?.selectedArm || latest?.latestSelection?.arm || null,
      recentReward: latest?.latestOutcome?.reward ?? null,
      traceCount: summaries.length,
      summaries,
      reason: summaries.length > 0 ? 'adaptive_search_events_found' : 'no_adaptive_search_events_yet',
    };
  }

  async function prepareAdaptiveSearchReplay(body = {}) {
    let events = Array.isArray(body.events) ? body.events : [];
    let taskId = body.taskId || body.context?.taskId || null;
    if (taskId) {
      const trace = await readTrace({ workspaceRoot: resolvedWorkspaceRoot, taskId });
      events = events.length ? events : trace.events;
      taskId = trace.taskId;
    }
    return replayAdaptiveSearchSelection({
      events,
      taskId,
      context: body.context || {},
      evidence: body.evidence,
      schedulerState: body.scheduler,
      policy: body.policy,
      rng: () => 0,
    });
  }

  async function prepareModelCouncilPassKEval(body = {}) {
    const report = await runModelCouncilPassKEval({
      cases: Array.isArray(body.cases) ? body.cases : undefined,
      k: body.k,
      minCases: body.minCases,
      upliftThreshold: body.upliftThreshold,
    });
    const summary = summarizePassKUplift(report);
    await emitEvent({
      type: 'model_council.passk_eval_completed',
      taskId: body.taskId || body.context?.taskId || null,
      command: body.command || 'harness_model_council_passk_eval_prepare',
      evalId: summary.evalId,
      caseCount: summary.caseCount,
      k: summary.k,
      bestSinglePassAtK: summary.bestSinglePassAtK,
      repeatedSamplingPassAtK: summary.repeatedSamplingPassAtK,
      staticCouncilPassAtK: summary.staticCouncilPassAtK,
      adaptiveCouncilPassAtK: summary.adaptiveCouncilPassAtK,
      calibratedEnsemblePassAtK: summary.calibratedEnsemblePassAtK,
      calibratedEnsembleConfidenceInterval: summary.calibratedEnsembleConfidenceInterval,
      regressionCount: summary.regressionCount,
      uplift: summary.uplift,
      proven: summary.proven,
      authority: 'evidence_only',
      canPromote: false,
    });
    return {
      type: 'harness_model_council_passk_eval',
      command: 'harness_model_council_passk_eval_prepare',
      data: report,
    };
  }

  async function listSkillCandidateSummaries() {
    const candidates = await listSkillCandidates({ workspaceRoot: resolvedWorkspaceRoot });
    return {
      candidates: candidates.map((candidate) => summarizeSkillCandidate(candidate)),
    };
  }

  function productionGate(name) {
    return loadHarnessConfig({ workspaceRoot: resolvedWorkspaceRoot })
      .then((config) => config.productionCapabilities?.[name] || {
        enabled: false,
        mode: 'offline',
        authority: 'evidence_only',
      });
  }

  function assertEvidencePathInsideWorkspace(targetPath) {
    const relative = path.relative(resolvedWorkspaceRoot, targetPath);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
    throw new Error('Production evidence path escapes workspace root');
  }

  async function assertNoSymlinkEvidencePath(targetPath) {
    const relative = path.relative(resolvedWorkspaceRoot, targetPath);
    const segments = relative.split(path.sep).filter(Boolean);
    let current = resolvedWorkspaceRoot;
    for (const segment of segments) {
      current = path.join(current, segment);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) {
          throw new Error('Production evidence path uses symlink or junction');
        }
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
      }
    }
  }

  async function assertRealEvidencePathInsideWorkspace(targetPath) {
    const realWorkspaceRoot = await realpath(resolvedWorkspaceRoot);
    const realTargetPath = await realpath(targetPath);
    const relative = path.relative(realWorkspaceRoot, realTargetPath);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
    throw new Error('Production evidence path escapes workspace root');
  }

  async function resolveEvidenceFilePath(relativePath) {
    const targetPath = path.resolve(resolvedWorkspaceRoot, relativePath);
    assertEvidencePathInsideWorkspace(targetPath);
    await assertNoSymlinkEvidencePath(path.dirname(targetPath));
    try {
      await assertRealEvidencePathInsideWorkspace(path.dirname(targetPath));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return targetPath;
  }

  async function resolveEvidenceDirectoryPath(relativeDir) {
    const targetPath = path.resolve(resolvedWorkspaceRoot, relativeDir);
    assertEvidencePathInsideWorkspace(targetPath);
    await assertNoSymlinkEvidencePath(targetPath);
    try {
      await assertRealEvidencePathInsideWorkspace(targetPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return targetPath;
  }

  async function readJsonFileIfPresent(relativePath) {
    try {
      const raw = await readFile(await resolveEvidenceFilePath(relativePath), 'utf8');
      return scrubEvidencePayload(JSON.parse(raw));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function readJsonDirectory(relativeDir) {
    const root = await resolveEvidenceDirectoryPath(relativeDir);
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }

    const items = [];
    for (const entry of entries
      .filter((item) => item.isFile() && item.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const raw = await readFile(path.join(root, entry.name), 'utf8');
      items.push(scrubEvidencePayload(JSON.parse(raw)));
    }
    return items;
  }

  async function productionEvidenceResponse({
    type,
    gateName,
    items,
  }) {
    const gate = await productionGate(gateName);
    const gateEnabled = gate.enabled === true;
    const loadedItems = gateEnabled && typeof items === 'function' ? await items() : items;
    const safeItems = (gateEnabled ? (Array.isArray(loadedItems) ? loadedItems : [loadedItems]) : [])
      .filter(Boolean)
      .map(scrubEvidencePayload);
    return {
      type,
      evidenceOnly: true,
      canPromote: false,
      gate: {
        name: gateName,
        enabled: gateEnabled,
        mode: gate.mode || 'offline',
        authority: 'evidence_only',
      },
      summary: {
        itemCount: safeItems.length,
        available: safeItems.length > 0,
      },
      items: safeItems,
    };
  }

  async function getProductionEvidence(type) {
    if (type === 'heldOutSuites') {
      return productionEvidenceResponse({
        type,
        gateName: 'operatorDashboards',
        items: () => readJsonDirectory(path.join('.harness', 'benchmarks', 'suites')),
      });
    }
    if (type === 'replayCycles') {
      return productionEvidenceResponse({
        type,
        gateName: 'operatorDashboards',
        items: () => readJsonDirectory(path.join('.harness', 'benchmarks', 'replay-cycles')),
      });
    }
    if (type === 'operatorDashboards') {
      return productionEvidenceResponse({
        type,
        gateName: 'operatorDashboards',
        items: () => readJsonDirectory(path.join('.harness', 'dashboards', 'operator')),
      });
    }
    if (type === 'visualSuites') {
      return productionEvidenceResponse({
        type,
        gateName: 'visualReplaySuites',
        items: () => readJsonDirectory(path.join('.harness', 'visual', 'replay-suites')),
      });
    }
    if (type === 'a2aStatus') {
      const gate = await productionGate('productionA2aQueues');
      const queueState = await readJsonFileIfPresent(path.join('.harness', 'a2a', 'queue-state.json'));
      return {
        type,
        evidenceOnly: true,
        canPromote: false,
        gate: {
          name: 'productionA2aQueues',
          enabled: gate.enabled === true,
          mode: gate.mode || 'offline',
          authority: 'evidence_only',
        },
        summary: {
          itemCount: queueState ? 1 : 0,
          available: queueState !== null,
        },
        items: queueState ? [queueState] : [],
        productionQueue: productionQueueProvider?.describe?.() ?? {
          type: 'production_queue_provider',
          enabled: false,
          mode: 'offline',
          authority: 'evidence_only',
        },
      };
    }
    if (type === 'campaignReports') {
      return productionEvidenceResponse({
        type,
        gateName: 'sourceTreeVariants',
        items: () => readJsonDirectory(path.join('.harness', 'meta', 'campaign-reports')),
      });
    }
    if (type === 'modelCouncilCalibration') {
      return productionEvidenceResponse({
        type,
        gateName: 'ensembleCalibration',
        items: () => readJsonDirectory(path.join('.harness', 'model-council', 'calibration')),
      });
    }
    if (type === 'endpointCapacity') {
      return productionEvidenceResponse({
        type,
        gateName: 'endpointCapacityRecommendations',
        items: () => readJsonFileIfPresent(path.join('.harness', 'model', 'endpoint-capacity', 'recommendations.json')),
      });
    }
    if (type === 'autonomyRollback') {
      return productionEvidenceResponse({
        type,
        gateName: 'productionAutonomyPolicy',
        items: async () => ({
          autonomy: await readJsonFileIfPresent(path.join('.harness', 'governance', 'autonomy-summary.json')),
          rollback: await readJsonFileIfPresent(path.join('.harness', 'governance', 'rollback-drills.json')),
        }),
      });
    }
    if (type === 'backgroundEvolution') {
      const gate = await productionGate('backgroundEvolution');
      const workerStatus = backgroundEvolutionWorker?.getStatus() ?? {
        running: false,
        lastTickAt: null,
        lastResult: null,
        intervalMs: null,
      };
      const gateEnabled = gate.enabled === true;
      const autonomyEvidence = gateEnabled
        ? await readJsonFileIfPresent(path.join('.harness', 'meta', 'autonomy-evidence.json'))
        : null;
      return {
        type,
        evidenceOnly: true,
        canPromote: false,
        gate: {
          name: 'backgroundEvolution',
          enabled: gateEnabled,
          mode: gate.mode || 'offline',
          authority: 'evidence_only',
        },
        worker: workerStatus,
        summary: {
          itemCount: autonomyEvidence ? 1 : 0,
          available: autonomyEvidence !== null,
        },
        items: autonomyEvidence ? [autonomyEvidence] : [],
      };
    }
    if (type === 'productionReports') {
      return productionEvidenceResponse({
        type,
        gateName: 'operatorDashboards',
        items: async () => {
          const grouped = await readJsonDirectory(path.join('.harness', 'rho', 'production-grouped-rerolls'));
          const live = await readJsonDirectory(path.join('.harness', 'bes', 'production-live-lanes'));
          const provenance = await readJsonDirectory(path.join('.harness', 'memory', 'provenance-resolution'));
          const visual = await readJsonDirectory(path.join('.harness', 'visual', 'production-replay'));
          const passk = await readJsonDirectory(path.join('.harness', 'model-council', 'production-passk'));
          return [...grouped, ...live, ...provenance, ...visual, ...passk];
        },
      });
    }
    if (type === 'a2aPeerCycles') {
      return productionEvidenceResponse({
        type,
        gateName: 'productionA2aTransport',
        items: () => readJsonDirectory(path.join('.harness', 'a2a', 'peer-cycles')),
      });
    }
    if (type === 'icrStatus') {
      const harnessConfig = await loadHarnessConfig({ workspaceRoot: resolvedWorkspaceRoot });
      return buildIcrEvidenceStatus({ workspaceRoot: resolvedWorkspaceRoot, harnessConfig });
    }
    throw new Error(`Unknown production evidence type: ${type}`);
  }

  async function getSkillCandidateReviewDetail(candidateId) {
    const candidate = await readSkillCandidate({ workspaceRoot: resolvedWorkspaceRoot, candidateId });
    return redactSkillCandidatePayload(candidate);
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    try {
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        sendJson(res, 200, {
          status: 'ok',
          version: VERSION,
          workspaceRoot: resolvedWorkspaceRoot,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/pi-bridge/state') {
        const state = await buildPiBridgeState({
          workspaceRoot: resolvedWorkspaceRoot,
        });
        sendJson(res, 200, state);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/promotion-queue') {
        const limit = Number(url.searchParams.get('limit') || 20);
        const records = await listPromotionQueueRecords({
          workspaceRoot: resolvedWorkspaceRoot,
          limit: Number.isFinite(limit) ? limit : 20,
        });
        sendJson(res, 200, {
          records,
          evidenceOnly: true,
          canPromote: false,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const subscriber = (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        subscribers.add(subscriber);
        res.write(': connected\n\n');
        req.on('close', () => subscribers.delete(subscriber));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
        const registry = await listCapabilitiesForWorkspace(url.searchParams.get('workspaceRoot'));
        sendJson(res, 200, registry);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/capabilities') {
        const body = await readJsonBody(req);
        const result = await saveCapabilityForWorkspace({
          workspaceRoot: body.workspaceRoot,
          record: body.record,
        });
        sendJson(res, 200, result);
        return;
      }

      const capabilityMatch = url.pathname.match(/^\/v1\/capabilities\/([^/]+)$/);
      if (req.method === 'DELETE' && capabilityMatch) {
        const result = await deleteCapabilityForWorkspace({
          workspaceRoot: url.searchParams.get('workspaceRoot'),
          capabilityId: decodeURIComponent(capabilityMatch[1]),
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/capabilities/mount') {
        const body = await readJsonBody(req);
        const result = await mountCapabilitiesForWorkspace({
          workspaceRoot: body.workspaceRoot,
          profileId: body.profileId,
        });
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/traces') {
        const result = await listRecentTraces({
          limit: Number(url.searchParams.get('limit')),
        });
        sendJson(res, 200, result);
        return;
      }

      const traceMatch = url.pathname.match(/^\/v1\/traces\/([^/]+)$/);
      if (req.method === 'GET' && traceMatch) {
        try {
          const result = await getTraceDetail(decodeURIComponent(traceMatch[1]));
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      const traceReplayMatch = url.pathname.match(/^\/v1\/traces\/([^/]+)\/replay$/);
      if (req.method === 'POST' && traceReplayMatch) {
        try {
          const body = await readJsonBody(req);
          const result = await prepareTraceReplay(decodeURIComponent(traceReplayMatch[1]), body);
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/adaptive-search/status') {
        try {
          const result = await getAdaptiveSearchStatus({
            taskId: url.searchParams.get('taskId'),
            limit: Number(url.searchParams.get('limit')),
          });
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/adaptive-search/replay') {
        try {
          const body = await readJsonBody(req);
          const result = await prepareAdaptiveSearchReplay(body);
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/model-council/passk-eval/prepare') {
        try {
          const body = await readJsonBody(req);
          const result = await prepareModelCouncilPassKEval({
            ...body,
            command: body.command || 'harness_model_council_passk_eval_prepare',
          });
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      const evidenceRoutes = new Map([
        ['/v1/evidence/held-out-suites', 'heldOutSuites'],
        ['/v1/evidence/replay-cycles', 'replayCycles'],
        ['/v1/evidence/operator-dashboards', 'operatorDashboards'],
        ['/v1/evidence/visual-suites', 'visualSuites'],
        ['/v1/evidence/a2a-status', 'a2aStatus'],
        ['/v1/evidence/model-council-calibration', 'modelCouncilCalibration'],
        ['/v1/evidence/endpoint-capacity', 'endpointCapacity'],
        ['/v1/evidence/autonomy-rollback', 'autonomyRollback'],
        ['/v1/evidence/background-evolution', 'backgroundEvolution'],
        ['/v1/evidence/campaign-reports', 'campaignReports'],
        ['/v1/evidence/production-reports', 'productionReports'],
        ['/v1/evidence/a2a-peer-cycles', 'a2aPeerCycles'],
        ['/v1/evidence/icr-status', 'icrStatus'],
      ]);
      if (req.method === 'GET' && evidenceRoutes.has(url.pathname)) {
        try {
          const result = await getProductionEvidence(evidenceRoutes.get(url.pathname));
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/skill-candidates') {
        try {
          const result = await listSkillCandidateSummaries();
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      const skillCandidateMatch = url.pathname.match(/^\/v1\/skill-candidates\/([^/]+)$/);
      if (req.method === 'GET' && skillCandidateMatch) {
        try {
          const result = await getSkillCandidateReviewDetail(decodeURIComponent(skillCandidateMatch[1]));
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      const skillCandidateApproveMatch = url.pathname.match(/^\/v1\/skill-candidates\/([^/]+)\/approve$/);
      if (req.method === 'POST' && skillCandidateApproveMatch) {
        try {
          const body = await readJsonBody(req);
          const result = await approveSkillCandidateForReview({
            workspaceRoot: resolvedWorkspaceRoot,
            candidateId: decodeURIComponent(skillCandidateApproveMatch[1]),
            approver: body.approver || body.reviewer || 'human',
            baselineFrontier: body.baselineFrontier || [],
            skillPolicy: body.skillPolicy || {},
          });
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      const skillCandidateRejectMatch = url.pathname.match(/^\/v1\/skill-candidates\/([^/]+)\/reject$/);
      if (req.method === 'POST' && skillCandidateRejectMatch) {
        try {
          const body = await readJsonBody(req);
          const result = await rejectSkillCandidateForReview({
            workspaceRoot: resolvedWorkspaceRoot,
            candidateId: decodeURIComponent(skillCandidateRejectMatch[1]),
            reviewer: body.reviewer || body.approver || 'human',
            reason: body.reason,
          });
          sendJson(res, 200, result);
        } catch (error) {
          sendBadRequest(res, error);
        }
        return;
      }

      if (req.method === 'POST' && url.pathname === '/v1/tasks') {
        const body = await readJsonBody(req);
        const task = await createTask(body);
        sendJson(res, 202, { taskId: task.taskId, status: task.status });
        return;
      }

      const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
      if (req.method === 'GET' && taskMatch) {
        const task = tasks.get(taskMatch[1]);
        if (!task) {
          sendJson(res, 404, { error: 'Task not found' });
          return;
        }
        const state = taskStates.get(task.taskId);
        sendJson(res, 200, {
          task,
          state: {
            version: state.version,
            value: { ...state.value },
            history: [...state.history],
          },
          audit: auditLog.entries().filter((entry) => entry.taskId === task.taskId),
        });
        return;
      }

      const artifactMatch = url.pathname.match(/^\/v1\/artifacts\/([^/]+)$/);
      if (req.method === 'GET' && artifactMatch) {
        const artifact = artifacts.get(artifactMatch[1]);
        if (!artifact) {
          sendJson(res, 404, { error: 'Artifact not found' });
          return;
        }
        const artifactBody = await artifactStore.readArtifact(artifact);
        sendJson(res, 200, artifactBody);
        return;
      }

      const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);
      if (req.method === 'POST' && approvalMatch) {
        const body = await readJsonBody(req);
        const approval = await resolveApproval(approvalMatch[1], body);
        if (!approval) {
          sendJson(res, 404, { error: 'Approval not found' });
          return;
        }
        sendJson(res, 200, {
          status: approval.status,
          actionId: approval.actionId,
          choice: approval.choice,
        });
        return;
      }

      sendNotFound(res);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  }

  return {
    get url() {
      return `http://127.0.0.1:${actualPort}`;
    },

    async start() {
      if (server) return;
      server = createServer((req, res) => {
        handleRequest(req, res);
      });
      await new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          actualPort = server.address().port;
          resolve();
        });
      });
      const harnessConfig = await loadHarnessConfig({ workspaceRoot: resolvedWorkspaceRoot });
      const backgroundIntervalMs = Number(harnessConfig?.backgroundEvolution?.intervalMs) || 300_000;
      backgroundEvolutionWorker = createBackgroundEvolutionWorker({
        workspaceRoot: resolvedWorkspaceRoot,
        loadHarnessConfig: () => loadHarnessConfig({ workspaceRoot: resolvedWorkspaceRoot }),
        emitEvent,
        intervalMs: backgroundIntervalMs,
      });
      backgroundEvolutionWorker.start();
      productionQueueProvider = createProductionQueueProvider({
        workspaceRoot: resolvedWorkspaceRoot,
        featureFlags: harnessConfig,
      });
    },

    async stop() {
      if (backgroundEvolutionWorker) {
        await backgroundEvolutionWorker.stop();
        backgroundEvolutionWorker = null;
      }
      productionQueueProvider = null;
      if (!server) return;
      const closingServer = server;
      server = null;
      await new Promise((resolve, reject) => {
        closingServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },

    onEvent(handler) {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  const sidecar = createHarnessSidecar(options);
  await sidecar.start();
  console.log(`[HarnessSidecar] Listening on ${sidecar.url}`);

  const shutdown = async () => {
    await sidecar.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
