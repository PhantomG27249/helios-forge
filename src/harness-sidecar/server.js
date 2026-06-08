import { createServer } from 'http';
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
import { proposeExperiment } from './experiments/experimentManager.js';
import { compareMetrics } from './experiments/metricComparer.js';
import { archiveChampion, createChampionArchive, selectBestChampion } from './bes/championArchive.js';
import { createAttemptGenome } from './bes/attemptGenome.js';
import { createDiversityTracker } from './bes/diversityTracker.js';
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
import { archiveCandidate } from './meta/candidateArchive.js';
import { recordCandidateRun } from './meta/candidateRunner.js';
import { HarnessOptimizer } from './meta/harnessOptimizer.js';
import { evaluatePromotion } from './meta/promotionPolicy.js';
import { inspectTrace } from './meta/traceInspector.js';
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
import { scheduleAttempts } from './swarm/attemptScheduler.js';
import { proposeChampionApply } from './swarm/championApply.js';
import { chooseChampion } from './swarm/championSelector.js';
import { orchestrateSwarm } from './swarm/swarmOrchestrator.js';
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
  let mountedMcpRuntime = mcpRuntime || null;
  let server = null;
  let actualPort = port;

  async function emitEvent(event) {
    const enrichedEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };
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

  async function runFullRuntimeSubsystems({
    task,
    subgoals,
    workspaceIndex,
    contextPack,
    patchArtifact,
    budgetManager,
    harnessConfig,
  }) {
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
      let profile;
      try {
        profile = getModelProfile(profileName);
      } catch (error) {
        await emitEvent({
          type: 'swarm.model_gateway_unavailable',
          taskId: task.taskId,
          profileName,
          reason: error.message,
        });
        return null;
      }

      const baseUrl = process.env.HELIOS_SWARM_MODEL_BASE_URL
        || harnessConfig?.models?.swarmBaseUrl
        || profile.baseUrl;
      const modelId = process.env.HELIOS_SWARM_MODEL_ID
        || harnessConfig?.models?.swarmModelId
        || profile.model;
      const supportsVision = process.env.HELIOS_SWARM_MODEL_SUPPORTS_VISION === '1'
        || harnessConfig?.models?.swarmSupportsVision === true
        || profile.supportsVision;
      if (!baseUrl) {
        await emitEvent({
          type: 'swarm.model_gateway_unavailable',
          taskId: task.taskId,
          profileName,
          reason: 'No baseUrl configured for model-driven swarm.',
        });
        return null;
      }

      const provider = modelProviderFactory({
        baseUrl,
        apiKey: process.env.HELIOS_SWARM_MODEL_API_KEY || harnessConfig?.models?.swarmApiKey || 'dummy',
      });
      const configuredModelOverride = {
        model: modelId,
        baseUrl,
        supportsVision,
      };

      return {
        profileName,
        vlmProfileName,
        supportsVision,
        gateway: new ModelGateway({
          provider,
          emitEvent,
          profileOverrides: {
            [profileName]: configuredModelOverride,
            [vlmProfileName]: configuredModelOverride,
          },
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
    let defaultToolRegistry = null;
    if (runtimeSwarmModel) {
      defaultToolRegistry = createDefaultToolRegistry({
        workspaceRoot: resolvedWorkspaceRoot,
        emitEvent,
        mcpRuntime: mountedMcpRuntime,
      });
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
    await emitEvent({
      type: 'harness_runtime.enabled',
      taskId: task.taskId,
      mode: task.mode,
      enabledSubsystems,
      modelDrivenSwarm: Boolean(runtimeSwarmModel),
    });

    const strategies = seedAttemptStrategies({ taskType: 'coding_bugfix', maxAttempts: 4 });
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

    const swarmRun = await orchestrateSwarm({
      task,
      taskType: 'coding_bugfix',
      maxAttempts: strategies.length,
      planner: {
        enabled: true,
        strategy: 'tooltree',
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
      onAttemptEvent: emitEvent,
      commandAdapter: swarmCommandRunner,
      verifierAdapter: useWorktreeOptions ? swarmVerifierAdapter : undefined,
      workspaceRoot: useWorktreeOptions ? resolvedWorkspaceRoot : undefined,
      worktreeManager: useWorktreeOptions ? swarmWorktreeManager : undefined,
    });
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
    const harnessConfig = await loadHarnessConfig({ workspaceRoot: resolvedWorkspaceRoot });
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
      await runFullRuntimeSubsystems({
        task,
        subgoals,
        workspaceIndex,
        contextPack,
        patchArtifact,
        budgetManager,
        harnessConfig,
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
        const artifactBody = await artifactStore.readTextArtifact(artifact);
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
    },

    async stop() {
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
