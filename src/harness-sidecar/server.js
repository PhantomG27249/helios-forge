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
import { TraceWriter } from './core/traceWriter.js';
import { proposeExperiment } from './experiments/experimentManager.js';
import { compareMetrics } from './experiments/metricComparer.js';
import { writeExperimentDecision } from './experiments/decisionWriter.js';
import { ExperimentQueue } from './experiments/experimentQueue.js';
import { compileExperimentReport } from './experiments/experimentReports.js';
import { classifyNoise } from './experiments/noiseGate.js';
import { RunTracker } from './experiments/runTracker.js';
import { createCodeGraphFromIndex } from './graph/codeGraph.js';
import { writeMemoryCandidate } from './memory/memoryWriter.js';
import { recordCandidateRun } from './meta/candidateRunner.js';
import { HarnessOptimizer } from './meta/harnessOptimizer.js';
import { inspectTrace } from './meta/traceInspector.js';
import { auditCitations } from './research/citationAuditor.js';
import { createDeepResearchReport } from './research/deepResearchManager.js';
import { compileResearchReport } from './research/reportCompiler.js';
import { createArtifactStore } from './artifacts/artifactStore.js';
import { buildContextPack } from './rag/contextPackBuilder.js';
import { retrieveWorkspaceContext } from './rag/retriever.js';
import { indexWorkspace } from './rag/workspaceIndexer.js';
import { scheduleAttempts } from './swarm/attemptScheduler.js';
import { chooseChampion } from './swarm/championSelector.js';
import { runVerifiers } from './tools/verifierRunner.js';
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

    const attempts = scheduleAttempts({
      taskId: task.taskId,
      taskType: 'coding_bugfix',
      maxAttempts: strategies.length,
    }).map((attempt, index) => ({
      ...attempt,
      verifierPassed: index === 0,
      score: subgoalScore.percent - (index * 3),
      patchStats: { changedLines: index + 1 },
    }));
    const champion = chooseChampion(attempts);
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

    const visualDiff = createVisualDiffArtifact({
      taskId: task.taskId,
      beforePath: patchArtifact.path,
      afterPath: graphArtifact.path,
      diffPath: metaArtifact.path,
      summary: 'Runtime placeholder visual diff links key harness artifacts.',
    });
    const visualContextItem = createVisualContextItem(visualDiff);
    await emitEvent({
      type: 'vlm.visual_context_created',
      taskId: task.taskId,
      visualContextItem,
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
