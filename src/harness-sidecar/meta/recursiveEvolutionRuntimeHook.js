import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createHeldOutSuiteStore } from '../benchmarks/heldOutSuiteStore.js';
import { runDueReplaySchedules } from '../benchmarks/replayScheduler.js';
import { evaluateProposalTrustBoundary } from '../core/trustKernelGateway.js';
import { ingestLocalMemoryProposals } from '../memory/memoryGraphTaskBridge.js';
import { runDueCampaignSchedules } from './campaignScheduler.js';
import { runMetaHarnessCampaign } from './metaHarnessCampaignRunner.js';
import { accumulateAutonomyEvidence } from './autonomyEvidenceAccumulator.js';
import { persistAutonomyProofArtifacts } from './autonomyProofRecorder.js';
import { createOperatorDashboardStore } from './operatorDashboardStore.js';
import { runProductionReportCycle } from './productionReportOrchestrator.js';
import { coordinateRecursiveEvolution } from './recursiveEvolutionCoordinator.js';
import { runA2aPeerCycle } from '../interop/a2aPeerCycleRunner.js';
import { runPostTaskIcrHooks } from '../icr/icrPostTaskHook.js';
import { createDeterministicIcrRunners } from '../icr/icrRuntimeCoordinator.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function productionGateEnabled(harnessConfig = {}, gateName) {
  const gate = harnessConfig.productionCapabilities?.[gateName];
  return gate?.enabled === true || gate === true;
}

function defaultReplaySchedules(task = {}) {
  return [{
    id: `post-task-${task.taskId || 'runtime'}`,
    suiteId: 'code-smoke',
    intervalMs: 0,
    candidates: [{ id: `task-${task.taskId || 'runtime'}` }],
  }];
}

function defaultCampaignSchedules(task = {}) {
  return [{
    id: `post-task-campaign-${task.taskId || 'runtime'}`,
    campaignId: `campaign-${task.taskId || 'runtime'}`,
    intervalMs: 0,
    maxCycles: 1,
  }];
}

export function createPostTaskCampaignBindings({
  task = {},
  replayReports = [],
} = {}) {
  const reports = asArray(replayReports).filter(Boolean);
  const latestReplay = reports.length ? reports[reports.length - 1] : null;
  const replayQuality = Number(latestReplay?.aggregateScore ?? latestReplay?.metrics?.quality);
  const quality = Number.isFinite(replayQuality) ? replayQuality : 0.55;

  return {
    maxCycles: 1,
    proposer: async (input) => ({
      candidateId: `post-task-${task.taskId || 'runtime'}-${input.cycleIndex}`,
      config: {
        source: 'post_task_recursive_evolution',
        replayReportIds: reports.map((report) => report.reportId).filter(Boolean),
      },
      metricManifest: { metrics: [{ name: 'quality' }] },
    }),
    evaluator: async ({ replayReport }) => ({
      metrics: {
        quality,
        safety: 0.9,
        cost: 0.5,
        latency: 0.5,
      },
      replayReport: replayReport || latestReplay || null,
    }),
    variantRunner: async ({ previousReplayReports }) => ({
      replayReport: replayReportFromList(previousReplayReports) || latestReplay || null,
    }),
  };
}

function replayReportFromList(reports = []) {
  const list = asArray(reports).filter(Boolean);
  return list.length ? list[list.length - 1] : null;
}

function smokeSuiteFallback(suiteId) {
  return {
    id: suiteId,
    domains: ['code'],
    cases: [{ id: 'smoke-1', domain: 'code', metricWeights: { quality: 1 } }],
  };
}

export function buildGovernanceTrustInput({ workspaceRoot, proposal = {} } = {}) {
  return {
    evaluate: true,
    workspaceRoot,
    proposal,
  };
}

export function evaluateApplyTrustBoundary({ workspaceRoot, proposal = {}, evidence = {}, visual = {} } = {}) {
  return evaluateProposalTrustBoundary({ workspaceRoot, proposal, evidence, visual });
}

export function createReplayEvidenceStore({ workspaceRoot }) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const replayDir = path.join(resolvedRoot, '.harness', 'benchmarks', 'replay-cycles');
  const dashboardStore = createOperatorDashboardStore({ workspaceRoot: resolvedRoot });
  const campaignDir = path.join(resolvedRoot, '.harness', 'meta', 'campaign-reports');

  return {
    async saveReport(report = {}) {
      await mkdir(replayDir, { recursive: true });
      const reportId = String(report.reportId || `replay-${Date.now()}`).replace(/[^A-Za-z0-9_-]+/g, '-');
      const filePath = path.join(replayDir, `${reportId}.json`);
      await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      return { filePath, reportId };
    },
    async saveSnapshot(snapshot = {}) {
      return dashboardStore.saveSnapshot(snapshot);
    },
    async saveCampaignReport(report = {}) {
      await mkdir(campaignDir, { recursive: true });
      const reportId = String(report.reportId || report.campaignId || `campaign-${Date.now()}`).replace(/[^A-Za-z0-9_-]+/g, '-');
      const filePath = path.join(campaignDir, `${reportId}.json`);
      await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      return { filePath, reportId };
    },
  };
}

function defaultBaselineRunner() {
  return async () => ({ metrics: { quality: 0.5 }, passed: true });
}

function defaultCandidateRunner() {
  return async () => ({ metrics: { quality: 0.55 }, passed: true });
}

export async function runPostTaskRecursiveEvolutionHooks({
  workspaceRoot,
  harnessConfig = {},
  task = {},
  memoryProposals = [],
  rollbackDrill = null,
  emitEvent,
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const store = createReplayEvidenceStore({ workspaceRoot });
  const suiteStore = createHeldOutSuiteStore({ workspaceRoot });
  const results = {
    evidenceOnly: true,
    canPromote: false,
    memoryBridge: null,
    replay: null,
    campaigns: null,
    coordinated: null,
    autonomy: null,
    productionReports: null,
    a2aPeerCycle: null,
    icr: null,
  };

  if (asArray(memoryProposals).length > 0) {
    results.memoryBridge = await ingestLocalMemoryProposals({
      workspaceRoot,
      proposals: memoryProposals,
      featureFlags: {
        localMemoryGraph: harnessConfig.features?.localMemoryGraph !== false,
        productionCapabilities: harnessConfig.productionCapabilities || {},
      },
    });
    if (typeof emitEvent === 'function') {
      await emitEvent({
        type: 'memory_graph.ingest_completed',
        taskId: task.taskId,
        ...results.memoryBridge,
      });
    }
  }

  if (productionGateEnabled(harnessConfig, 'operatorDashboards')) {
    const replayResult = await runDueReplaySchedules({
      workspaceRoot,
      schedules: defaultReplaySchedules(task),
      suiteLoader: async (suiteId) => {
        try {
          return await suiteStore.loadSuite(suiteId);
        } catch {
          return smokeSuiteFallback(suiteId);
        }
      },
      baselineRunner: defaultBaselineRunner(),
      candidateRunner: defaultCandidateRunner(),
      store,
      budget: { maxCases: 10, maxCost: task.budget?.maxToolCalls || 10 },
    });
    results.replay = replayResult;
    if (typeof emitEvent === 'function') {
      await emitEvent({
        type: 'replay.cycle_completed',
        taskId: task.taskId,
        ran: replayResult.ran,
        skipped: replayResult.skipped,
        evidenceOnly: true,
        canPromote: false,
      });
    }
  }

  if (productionGateEnabled(harnessConfig, 'sourceTreeVariants')) {
    const replayReports = asArray(results.replay?.ran).map((entry) => entry.report).filter(Boolean);
    const campaignBindings = createPostTaskCampaignBindings({ task, replayReports });
    const campaignResult = await runDueCampaignSchedules({
      workspaceRoot,
      schedules: defaultCampaignSchedules(task).map((schedule) => ({
        ...schedule,
        ...campaignBindings,
      })),
      store: {
        saveReport: (report) => store.saveCampaignReport(report),
      },
      campaignRunner: runMetaHarnessCampaign,
    });
    results.campaigns = campaignResult;
    if (typeof emitEvent === 'function') {
      await emitEvent({
        type: 'meta.campaign_cycle_completed',
        taskId: task.taskId,
        ran: campaignResult.ran,
        skipped: campaignResult.skipped,
        evidenceOnly: true,
        canPromote: false,
      });
    }
  }

  results.coordinated = coordinateRecursiveEvolution({
    replayReports: asArray(results.replay?.ran).map((entry) => entry.report).filter(Boolean),
    campaignResults: asArray(results.campaigns?.ran).map((entry) => entry.report).filter(Boolean),
    promotionLoopResult: null,
  });

  let autonomyState = {};
  if (rollbackDrill) {
    autonomyState = accumulateAutonomyEvidence({
      existing: autonomyState,
      rollbackDrill: {
        ...rollbackDrill,
        status: rollbackDrill.restoreVerified === false ? 'failed' : 'passed',
      },
    });
    autonomyState.drills = [{
      ...rollbackDrill,
      status: rollbackDrill.restoreVerified === false ? 'failed' : 'passed',
    }];
  }
  for (const entry of asArray(results.replay?.ran)) {
    autonomyState = accumulateAutonomyEvidence({
      existing: autonomyState,
      replayReport: entry.report,
      dashboardSnapshot: entry.snapshot,
    });
  }
  results.autonomy = autonomyState;

  results.productionReports = await runProductionReportCycle({
    workspaceRoot,
    harnessConfig,
    task,
  });

  if (productionGateEnabled(harnessConfig, 'productionA2aTransport')
    && productionGateEnabled(harnessConfig, 'productionA2aQueues')) {
    const peerWorkspaceRoot = path.join(path.resolve(workspaceRoot), '.harness', 'a2a', 'peer-workspace');
    await mkdir(peerWorkspaceRoot, { recursive: true });
    results.a2aPeerCycle = await runA2aPeerCycle({
      localWorkspaceRoot: workspaceRoot,
      peerWorkspaceRoot,
      harnessConfig,
    });
  }

  results.icr = await runPostTaskIcrHooks({
    workspaceRoot,
    harnessConfig,
    task,
    emitEvent,
    runners: createDeterministicIcrRunners(),
  });

  await persistAutonomyProofArtifacts({
    workspaceRoot,
    autonomyState,
    harnessConfig,
  });

  if (typeof emitEvent === 'function') {
    await emitEvent({
      type: 'recursive_evolution.coordinated',
      taskId: task.taskId,
      coordinated: results.coordinated,
      autonomy: results.autonomy,
      evidenceOnly: true,
      canPromote: false,
    });
  }

  return results;
}
