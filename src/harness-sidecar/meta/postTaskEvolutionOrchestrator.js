import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createHeldOutSuiteStore } from '../benchmarks/heldOutSuiteStore.js';
import { runDueReplaySchedules } from '../benchmarks/replayScheduler.js';
import {
  createTaskReplayRunners,
  HeldOutSuiteRequiredError,
} from '../benchmarks/taskReplayRunners.js';
import { runDueCampaignSchedules } from './campaignScheduler.js';
import { coordinateRecursiveEvolution } from './recursiveEvolutionCoordinator.js';
import { runMetaHarnessCampaign } from './metaHarnessCampaignRunner.js';
import { createPostTaskCampaignBindings } from './postTaskCampaignBindings.js';
import { loadTaskEvolutionInputs } from './taskEvolutionInputs.js';
import {
  appendFrontierDashboardEntry as defaultAppendFrontierDashboardEntry,
  writeBackgroundTickRecord as defaultWriteBackgroundTickRecord,
} from './frontierPersistence.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function productionGateEnabled(harnessConfig = {}, gateName) {
  const gate = harnessConfig.productionCapabilities?.[gateName];
  return gate?.enabled === true || gate === true;
}

function resolveNowDate(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid orchestrator timestamp');
  return date;
}

function sanitizeReportId(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]+/g, '-');
}

function isHeldOutSuiteMissingError(error) {
  if (error instanceof HeldOutSuiteRequiredError) return true;
  if (error?.code === 'ENOENT') return true;
  const message = String(error?.message || '');
  return message.includes('held-out suite')
    || message.includes('suite id must')
    || message.includes('cases is required');
}

function defaultReplaySchedules(task = {}, suiteId) {
  return [{
    id: `post-task-${task.taskId || 'runtime'}`,
    suiteId,
    intervalMs: 0,
    candidates: [{ id: `task-${task.taskId || 'runtime'}` }],
  }];
}

function defaultCampaignSchedule(task = {}, isoTimestamp) {
  const taskId = task.taskId || 'runtime';
  const campaignId = sanitizeReportId(`campaign-${taskId}-${isoTimestamp}`);
  return {
    id: `post-task-campaign-${taskId}`,
    campaignId,
    reportId: campaignId,
    intervalMs: 0,
  };
}

export function createReplayEvidenceStore({ workspaceRoot } = {}) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const replayDir = path.join(resolvedRoot, '.harness', 'benchmarks', 'replay-cycles');
  const campaignDir = path.join(resolvedRoot, '.harness', 'meta', 'campaign-reports');

  return {
    async saveReport(report = {}) {
      await mkdir(replayDir, { recursive: true });
      const reportId = sanitizeReportId(report.reportId || `replay-${Date.now()}`);
      const filePath = path.join(replayDir, `${reportId}.json`);
      await writeFile(filePath, `${JSON.stringify({
        ...report,
        reportId,
        evidenceOnly: true,
        canPromote: false,
      }, null, 2)}\n`, 'utf8');
      return { filePath, reportId };
    },
    async saveCampaignReport(report = {}) {
      await mkdir(campaignDir, { recursive: true });
      const reportId = sanitizeReportId(
        report.reportId || report.campaignId || `campaign-${Date.now()}`,
      );
      const filePath = path.join(campaignDir, `${reportId}.json`);
      await writeFile(filePath, `${JSON.stringify({
        ...report,
        reportId,
        campaignId: report.campaignId || reportId,
        evidenceOnly: true,
        canPromote: false,
      }, null, 2)}\n`, 'utf8');
      return { filePath, reportId };
    },
  };
}

export async function runPostTaskEvolutionOrchestrator({
  workspaceRoot,
  harnessConfig = {},
  task = {},
  emitEvent,
  deps = {},
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const nowFn = deps.now || (() => new Date());
  const nowDate = resolveNowDate(nowFn);
  const isoTimestamp = nowDate.toISOString();

  const appendFrontierDashboardEntry = deps.appendFrontierDashboardEntry
    || defaultAppendFrontierDashboardEntry;
  const writeBackgroundTickRecord = deps.writeBackgroundTickRecord
    || defaultWriteBackgroundTickRecord;
  const loadEvolutionInputs = deps.loadTaskEvolutionInputs || loadTaskEvolutionInputs;
  const createCampaignBindings = deps.createPostTaskCampaignBindings || createPostTaskCampaignBindings;
  const createReplayRunners = deps.createTaskReplayRunners || createTaskReplayRunners;
  const runReplaySchedules = deps.runDueReplaySchedules || runDueReplaySchedules;
  const runCampaignSchedules = deps.runDueCampaignSchedules || runDueCampaignSchedules;
  const campaignRunner = deps.runMetaHarnessCampaign || runMetaHarnessCampaign;
  const coordinate = deps.coordinateRecursiveEvolution || coordinateRecursiveEvolution;
  const createSuiteStore = deps.createHeldOutSuiteStore || createHeldOutSuiteStore;
  const createStore = deps.createReplayEvidenceStore || createReplayEvidenceStore;

  const results = {
    evidenceOnly: true,
    canPromote: false,
    replay: null,
    campaigns: null,
    coordinated: null,
  };

  let coordinated = null;

  try {
    const store = createStore({ workspaceRoot });
    const suiteStore = createSuiteStore({ workspaceRoot });
    const syntheticReplay = harnessConfig.evolution?.syntheticReplay === true;
    const defaultSuiteId = harnessConfig.evolution?.defaultSuiteId || 'workplace-smoke';
    const persistFrontier = harnessConfig.evolution?.persistFrontier !== false;

    if (productionGateEnabled(harnessConfig, 'operatorDashboards')) {
      const scheduleId = `post-task-${task.taskId || 'runtime'}`;
      try {
        const suite = await suiteStore.loadSuite(defaultSuiteId);
        const { baselineRunner, candidateRunner } = createReplayRunners({
          workspaceRoot,
          suite,
          syntheticReplay,
          spawnImpl: deps.spawnImpl,
        });

        results.replay = await runReplaySchedules({
          workspaceRoot,
          schedules: defaultReplaySchedules(task, defaultSuiteId),
          suiteLoader: async (suiteId) => suiteStore.loadSuite(suiteId),
          baselineRunner,
          candidateRunner,
          store,
          budget: { maxCases: 10, maxCost: task.budget?.maxToolCalls || 10 },
          now: nowFn,
        });

        if (typeof emitEvent === 'function') {
          await emitEvent({
            type: 'replay.cycle_completed',
            taskId: task.taskId,
            ran: results.replay.ran,
            skipped: results.replay.skipped,
            evidenceOnly: true,
            canPromote: false,
          });
        }
      } catch (error) {
        if (!isHeldOutSuiteMissingError(error)) throw error;

        results.replay = {
          ran: [],
          skipped: [{ scheduleId, reason: 'held_out_suite_missing' }],
        };

        if (typeof emitEvent === 'function') {
          await emitEvent({
            type: 'replay.skipped',
            taskId: task.taskId,
            reason: 'held_out_suite_missing',
            skipped: results.replay.skipped,
            evidenceOnly: true,
            canPromote: false,
          });
        }
      }
    }

    if (productionGateEnabled(harnessConfig, 'sourceTreeVariants')) {
      const replayReports = asArray(results.replay?.ran)
        .map((entry) => entry.report)
        .filter(Boolean);
      const evolutionInputs = await loadEvolutionInputs({
        workspaceRoot,
        taskId: task.taskId,
      });
      const bindings = createCampaignBindings({
        task,
        replayReports,
        evolutionInputs,
        harnessConfig,
        commandRunner: deps.commandRunner,
        spawnImpl: deps.spawnImpl,
      });
      const campaignSchedule = defaultCampaignSchedule(task, isoTimestamp);

      results.campaigns = await runCampaignSchedules({
        workspaceRoot,
        schedules: [{
          ...campaignSchedule,
          maxCycles: bindings.maxCycles,
          sourceTree: bindings.sourceTree,
          proposer: bindings.proposer,
          evaluator: bindings.evaluator,
          variantRunner: bindings.variantRunner,
        }],
        store: {
          saveReport: async (report) => store.saveCampaignReport({
            ...report,
            reportId: campaignSchedule.reportId,
            campaignId: campaignSchedule.campaignId,
          }),
        },
        campaignRunner,
        now: nowFn,
      });

      if (typeof emitEvent === 'function') {
        await emitEvent({
          type: 'meta.campaign_cycle_completed',
          taskId: task.taskId,
          ran: results.campaigns.ran,
          skipped: results.campaigns.skipped,
          evidenceOnly: true,
          canPromote: false,
        });
      }
    }

    coordinated = coordinate({
      replayReports: asArray(results.replay?.ran).map((entry) => entry.report).filter(Boolean),
      campaignResults: asArray(results.campaigns?.ran).map((entry) => entry.report).filter(Boolean),
      promotionLoopResult: null,
    });
    results.coordinated = coordinated;

    if (persistFrontier) {
      const latestReplay = asArray(results.replay?.ran).map((entry) => entry.report).filter(Boolean).at(-1);
      const latestCampaign = asArray(results.campaigns?.ran).map((entry) => entry.report).filter(Boolean).at(-1);
      if (latestReplay || latestCampaign) {
        await appendFrontierDashboardEntry({
          workspaceRoot,
          replayReport: latestReplay || {},
          campaignReport: latestCampaign || {},
          recordedAt: isoTimestamp,
        });
      }
    }

    if (task.source === 'background') {
      const tickId = task.tickId
        || `background-${isoTimestamp.replace(/[-:.]/g, '')}`;
      await writeBackgroundTickRecord({
        workspaceRoot,
        tickId,
        hookResults: results,
        recordedAt: isoTimestamp,
      });
    }
  } finally {
    if (typeof emitEvent === 'function') {
      await emitEvent({
        type: 'recursive_evolution.coordinated',
        taskId: task.taskId,
        coordinated,
        evidenceOnly: true,
        canPromote: false,
      });
    }
  }

  return results;
}
