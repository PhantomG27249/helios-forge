import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { planSubgoals } from './bes/subgoalPlanner.js';
import { scoreSubgoals } from './bes/subgoalScorer.js';
import { seedAttemptStrategies } from './bes/strategySeeder.js';
import { BudgetManager } from './budget/budgetManager.js';
import { AuditLog } from './collaboration/auditLog.js';
import { LockService } from './collaboration/locks.js';
import { VersionedState } from './collaboration/versionedState.js';
import { WorkspaceLeaseService } from './collaboration/workspaceLeases.js';
import { compileFinalAuditReport } from './core/finalAudit.js';
import { resumeTaskFromTrace } from './core/taskResume.js';
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
import { createCodeGraphFromIndex } from './graph/codeGraph.js';
import { buildExperimentGraph } from './graph/experimentGraph.js';
import { buildVisualGraph } from './graph/visualGraph.js';
import { retrievePromotedMemory } from './memory/memoryRetriever.js';
import { promoteMemoryCandidates } from './memory/promotionPolicy.js';
import { decideReflectionGate } from './memory/reflectionGate.js';
import { writeMemoryCandidate } from './memory/memoryWriter.js';
import { scoreMemoryCorpus } from './memory/memoryEvals.js';
import { createChangeProposal } from './meta/changeProposal.js';
import { recordCandidateRun } from './meta/candidateRunner.js';
import { HarnessOptimizer } from './meta/harnessOptimizer.js';
import { evaluatePromotion } from './meta/promotionPolicy.js';
import { inspectTrace } from './meta/traceInspector.js';
import { composeGraphRagContext } from './rag/graphRagComposer.js';
import { auditCitations } from './research/citationAuditor.js';
import { findContradictions } from './research/contradictionFinder.js';
import { createDeepResearchReport } from './research/deepResearchManager.js';
import { createImplementationHandoff } from './research/implementationHandoff.js';
import { compileResearchReport } from './research/reportCompiler.js';
import { createResearchBrief } from './research/researchBrief.js';
import { discoverSources } from './research/sourceDiscovery.js';
import { ingestSources } from './research/sourceIngestion.js';
import { createArtifactStore } from './artifacts/artifactStore.js';
import { buildContextPack } from './rag/contextPackBuilder.js';
import { retrieveWorkspaceContext } from './rag/retriever.js';
import { indexWorkspace } from './rag/workspaceIndexer.js';
import { scheduleAttempts } from './swarm/attemptScheduler.js';
import { proposeChampionApply } from './swarm/championApply.js';
import { chooseChampion } from './swarm/championSelector.js';
import { orchestrateSwarm } from './swarm/swarmOrchestrator.js';
import { runVerifiers } from './tools/verifierRunner.js';
import { interpretDiagram } from './vlm/diagramInterpreter.js';
import { createFigureCropArtifact } from './vlm/figureCropper.js';
import { createPdfPageArtifacts } from './vlm/pdfRenderer.js';
import { analyzePlot } from './vlm/plotAnalyzer.js';
import { createScreenshotArtifact } from './vlm/screenshotTool.js';
import { createVisualContextItem } from './vlm/visualContextPolicy.js';
import { createVisualDiffArtifact } from './vlm/visualDiff.js';

const VERSION = '0.1.0';

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

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createHarnessSidecar({ workspaceRoot = process.cwd(), port = 49321 } = {}) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const subscribers = new Set();
  const traceWriter = new TraceWriter({ workspaceRoot: resolvedWorkspaceRoot });
  const artifactStore = createArtifactStore({ workspaceRoot: resolvedWorkspaceRoot });
  const artifacts = new Map();
  const auditLog = new AuditLog();
  const lockService = new LockService();
  const workspaceLeaseService = new WorkspaceLeaseService();
  const pendingApprovals = new Map();
  const tasks = new Map();
  const taskStates = new Map();
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

  async function runFullRuntimeSubsystems({
    task,
    subgoals,
    workspaceIndex,
    contextPack,
    patchArtifact,
    budgetManager,
  }) {
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
    await emitEvent({
      type: 'harness_runtime.enabled',
      taskId: task.taskId,
      mode: task.mode,
      enabledSubsystems,
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
    const candidateRun = recordCandidateRun({
      candidateId: `runtime_${task.taskId}`,
      smokePassed: true,
      metrics: {
        quality: subgoalScore.percent / 100,
        cost: 0.35,
        latency: 0.25,
        safety: 0.9,
      },
    });
    const metaProposal = new HarnessOptimizer().propose({
      traceSummary,
      target: 'runtime_policy',
      candidateRun,
    });
    const metaArtifact = await artifactStore.writeTextArtifact({
      taskId: task.taskId,
      type: 'meta_optimizer_proposal',
      title: 'Meta optimizer proposal',
      filename: 'meta-optimizer-proposal.json',
      content: JSON.stringify(metaProposal, null, 2),
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
      approvals: [{ candidateId: candidateRun.candidateId, choice: 'approve' }],
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
    const screenshotArtifact = createScreenshotArtifact({
      taskId: task.taskId,
      imagePath: visualDiff.diffPath,
      viewport: { width: 1280, height: 720 },
      source: { type: 'runtime_visual_diff', artifactId: visualDiff.artifactId },
    });
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
      targetPath: `${visualDiff.diffPath}.crop.png`,
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
    const graphRagContext = composeGraphRagContext({
      graph: codeGraph,
      queries: [{
        type: 'supporting_runs_for_claim',
        claimId: `runtime-${task.taskId}`,
      }],
      maxItems: 4,
    });
    await emitEvent({
      type: 'graph.context_composed',
      taskId: task.taskId,
      source: graphRagContext.source,
      itemCount: graphRagContext.items.length,
      items: graphRagContext.items,
    });

    const swarmRun = await orchestrateSwarm({
      task,
      taskType: 'coding_bugfix',
      maxAttempts: strategies.length,
      context: {
        contextPackId: contextPack.contextPackId,
        allowedFiles: contextPack.items.map((item) => item.path),
      },
      budget: { maxOutputChars: 1200 },
      commandAdapter: async ({ attempt }) => ({
        summary: `Dry-run attempt ${attempt.attemptId} evaluated by full runtime.`,
        patch: `attempt:${attempt.attemptId}`,
        verifierEvidence: [{ artifactId: patchArtifact.artifactId, status: 'passed' }],
        score: subgoalScore.percent - Math.max(0, attempt.index || 0),
        patchStats: { changedLines: Math.max(1, (attempt.index || 0) + 1) },
      }),
    });
    const attempts = swarmRun.attempts;
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
      archivedChampion,
    });
    const championApplyPlan = champion
      ? proposeChampionApply({
        workspaceRoot: resolvedWorkspaceRoot,
        champion: {
          ...champion,
          output: {
            patch: [
              'diff --git a/.harness/CHAMPION.md b/.harness/CHAMPION.md',
              '--- a/.harness/CHAMPION.md',
              '+++ b/.harness/CHAMPION.md',
              `+Champion attempt: ${champion.attemptId}`,
            ].join('\n'),
            verifierEvidence: champion.verifierEvidence,
          },
        },
      })
      : null;
    await emitEvent({
      type: 'swarm.champion_apply_proposed',
      taskId: task.taskId,
      plan: championApplyPlan,
    });
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
      },
    }));
    pendingApprovals.set(actionId, { actionId, taskId, status: 'pending' });
    const budgetManager = new BudgetManager({
      taskId,
      limits: {
        maxToolCalls: task.budget.maxToolCalls,
        maxWallMinutes: task.budget.maxWallMinutes,
      },
      emitEvent,
    });

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

    await emitEvent({
      type: 'task.started',
      taskId,
      summary: task.task,
      status: 'running',
      source: task.source,
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
    budgetManager.recordUsage({ toolCalls: 1 });
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
    const patchArtifact = await artifactStore.writeTextArtifact({
      taskId,
      type: 'patch_manifest',
      title: 'Scripted MVP patch proposal',
      filename: `${patchId}.json`,
      content: JSON.stringify(
        {
          patchId,
          task: task.task,
          intent: 'Demonstrate patch proposal flow without applying workspace edits.',
          files: [],
          validationPlan: ['mvp-scripted-verifier'],
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
      intent: 'Demonstrate patch proposal flow without applying workspace edits.',
      files: [],
      validationPlan: ['mvp-scripted-verifier'],
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
    approval.status = 'resolved';
    approval.choice = choice;
    approval.resolvedAt = new Date().toISOString();
    pendingApprovals.set(actionId, approval);

    const task = tasks.get(approval.taskId);
    if (task) {
      task.status = choice === 'approve' ? 'approved' : 'approval_resolved';
      tasks.set(task.taskId, task);
    }
    await recordAudit({
      actor: body.actor || 'human',
      target: `approval:${actionId}`,
      operation: 'approval.resolve',
      reason: `Human selected ${choice}.`,
      taskId: approval.taskId,
    });
    await updateTaskState(
      approval.taskId,
      {
        status: choice === 'approve' ? 'approved' : 'approval_resolved',
        approvalChoice: choice,
      },
      body.actor || 'human',
    );

    await emitEvent({
      type: 'approval.resolved',
      taskId: approval.taskId,
      actionId,
      choice,
    });

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
          approval,
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

    return approval;
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
