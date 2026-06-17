import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createHeldOutSuiteStore } from '../benchmarks/heldOutSuiteStore.js';
import { runDueReplaySchedules } from '../benchmarks/replayScheduler.js';
import { evaluateProposalTrustBoundary } from '../core/trustKernelGateway.js';
import { ingestLocalMemoryProposals } from '../memory/memoryGraphTaskBridge.js';
import { runDueCampaignSchedules } from './campaignScheduler.js';
import { accumulateAutonomyEvidence } from './autonomyEvidenceAccumulator.js';
import { createOperatorDashboardStore } from './operatorDashboardStore.js';
import { coordinateRecursiveEvolution } from './recursiveEvolutionCoordinator.js';

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
  }];
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
    const campaignResult = await runDueCampaignSchedules({
      workspaceRoot,
      schedules: defaultCampaignSchedules(task),
      store: {
        saveReport: (report) => store.saveCampaignReport(report),
      },
      campaignRunner: async (input) => ({
        campaignId: input.schedule?.campaignId || input.campaignId,
        status: 'evidence_only',
        canPromote: false,
        variantCount: 0,
        evidenceOnly: true,
        ...input,
      }),
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
  }
  for (const entry of asArray(results.replay?.ran)) {
    autonomyState = accumulateAutonomyEvidence({
      existing: autonomyState,
      replayReport: entry.report,
      dashboardSnapshot: entry.snapshot,
    });
  }
  results.autonomy = autonomyState;

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
