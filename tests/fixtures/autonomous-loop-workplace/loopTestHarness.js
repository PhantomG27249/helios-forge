import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runReplayCycle } from '../../../src/harness-sidecar/benchmarks/replayCycleRunner.js';
import { detectWorkplaceTestRunner } from '../../../src/harness-sidecar/benchmarks/workplaceSuiteDetector.js';
import { accumulateAutonomyEvidence } from '../../../src/harness-sidecar/meta/autonomyEvidenceAccumulator.js';
import { processReplayReportForAutonomy } from '../../../src/harness-sidecar/meta/autonomyRollbackRunner.js';
import { applyPartialAutonomousImprovements } from '../../../src/harness-sidecar/meta/partialAutonomyApply.js';
import { wrapPostTaskEvolution } from '../../../src/harness-sidecar/meta/postTaskHookGuard.js';
import {
  bridgeReplayFeedback,
  buildReplayFeedbackItems,
} from '../../../src/harness-sidecar/meta/replayFeedbackBridge.js';
import {
  applyRuntimePolicyToHarnessConfig,
  MAX_MAX_ACTIONS_PER_TASK,
  MIN_MAX_ACTIONS_PER_TASK,
} from '../../../src/harness-sidecar/meta/runtimePolicyConsumer.js';
import {
  LIVE_POLICY_REL,
  loadRuntimePolicy,
  SHADOW_POLICY_REL,
} from '../../../src/harness-sidecar/meta/runtimePolicyStore.js';

const FIXTURE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPLAY_CYCLES_REL = '.harness/benchmarks/replay-cycles';

export const FIXTURE_HARNESS_CONFIG = Object.freeze({
  adaptiveSearch: { maxActionsPerTask: 8 },
  icr: { branchBreadth: 2, correctionDepth: 4 },
  partialAutonomy: {
    enabled: true,
    maxLevel: 3,
    thresholds: {
      minRollbackDrillsPassed: 0,
      maxRegressionCount: 99,
      minDashboardDepth: 0,
    },
  },
  productionCapabilities: {
    backgroundEvolution: { enabled: true },
    operatorDashboards: { enabled: true },
    sourceTreeVariants: { enabled: true },
  },
  evolution: {
    syntheticReplay: false,
    defaultSuiteId: 'workplace-smoke',
    persistFrontier: true,
    feedbackToChat: true,
  },
});

export function createPromptBackgroundTask(taskId = 'task_prompt_bg_1') {
  return {
    taskId,
    id: taskId,
    source: 'prompt_background',
  };
}

export async function copyFixtureWorkplace(targetRoot) {
  await cp(FIXTURE_ROOT, targetRoot, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}loopTestHarness.js`),
  });
}

export async function loadFixtureSuite(workspaceRoot) {
  const suitePath = path.join(
    workspaceRoot,
    '.harness',
    'benchmarks',
    'suites',
    'workplace-smoke.json',
  );
  return JSON.parse(await readFile(suitePath, 'utf8'));
}

async function persistReplayReport(workspaceRoot, report) {
  const replayDir = path.join(workspaceRoot, REPLAY_CYCLES_REL);
  await mkdir(replayDir, { recursive: true });
  const filePath = path.join(replayDir, `${report.reportId}.json`);
  const payload = {
    ...report,
    generatedAt: report.generatedAt || new Date().toISOString(),
    canPromote: false,
    promotionEvidenceOnly: true,
    authority: 'evidence_only',
    longitudinalTrend: report.longitudinalTrend || {
      classification: 'improvement',
      latestImprovementDelta: report.aggregateScore,
      aggregateDelta: report.aggregateScore,
    },
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { filePath, report: payload };
}

export async function runPostTaskReplayWithPositiveDelta({
  workspaceRoot,
  suite,
  now = () => new Date('2026-06-18T12:00:00.000Z'),
} = {}) {
  const resolvedSuite = suite || await loadFixtureSuite(workspaceRoot);
  const report = await runReplayCycle({
    suite: resolvedSuite,
    candidates: [{ id: 'candidate-improved' }],
    baselineRunner: async ({ case: replayCase }) => {
      const isPassCase = replayCase.id === 'workplace-pass';
      return {
        passed: isPassCase,
        metrics: { quality: isPassCase ? 0.4 : 0.0 },
      };
    },
    candidateRunner: async ({ case: replayCase }) => {
      const isPassCase = replayCase.id === 'workplace-pass';
      return {
        passed: true,
        metrics: { quality: isPassCase ? 1.0 : 0.8 },
      };
    },
    now,
  });

  if (!(Number(report.aggregateScore) > 0)) {
    throw new Error(`expected positive replay delta, got ${report.aggregateScore}`);
  }

  return persistReplayReport(workspaceRoot, report);
}

async function writeLivePolicyFromConsumer({
  workspaceRoot,
  harnessConfig,
  replayReport,
  policyVersion = 'loop-test-v1',
  now = () => new Date('2026-06-18T12:00:00.000Z'),
} = {}) {
  const shadow = await loadRuntimePolicy({ workspaceRoot });
  const consumerPreview = applyRuntimePolicyToHarnessConfig(harnessConfig, {
    ...shadow,
    partialAutonomy: { level: 3, levelName: 'reversible_runtime' },
    policyHints: {
      ...shadow.policyHints,
      aggregateScore: replayReport.aggregateScore,
      reportId: replayReport.reportId,
    },
  });

  const livePolicy = {
    schemaVersion: 1,
    policyVersion,
    evidenceOnly: false,
    canPromote: false,
    authority: 'reversible_runtime',
    partialAutonomy: {
      level: 3,
      levelName: 'reversible_runtime',
    },
    policyHints: {
      reportId: replayReport.reportId,
      suiteId: replayReport.suiteId,
      aggregateScore: replayReport.aggregateScore,
    },
    harnessAdjustments: {
      adaptiveSearch: {
        maxActionsPerTask: consumerPreview.harnessConfig.adaptiveSearch.maxActionsPerTask,
      },
      icr: {
        branchBreadth: consumerPreview.harnessConfig.icr.branchBreadth,
        correctionDepth: consumerPreview.harnessConfig.icr.correctionDepth,
      },
    },
    provenance: {
      replayReportId: replayReport.reportId,
      policyVersion,
      autonomyLevel: 3,
      appliedAt: (typeof now === 'function' ? now() : now).toISOString(),
    },
    updatedAt: (typeof now === 'function' ? now() : now).toISOString(),
  };

  const livePolicyPath = path.join(workspaceRoot, LIVE_POLICY_REL);
  await mkdir(path.dirname(livePolicyPath), { recursive: true });
  await writeFile(livePolicyPath, `${JSON.stringify(livePolicy, null, 2)}\n`, 'utf8');
  return { livePolicyPath, livePolicy, consumerPreview };
}

export async function simulatePostTaskAutonomyApply({
  workspaceRoot,
  harnessConfig,
  replayReport,
  autonomyState = {},
  emitEvent,
  now = () => new Date('2026-06-18T12:00:00.000Z'),
} = {}) {
  const shadowResult = await applyPartialAutonomousImprovements({
    workspaceRoot,
    harnessConfig,
    autonomyState,
    replayReports: [replayReport],
    emitEvent,
    now,
  });

  const { state, l3Apply } = processReplayReportForAutonomy({
    existing: autonomyState,
    replayReport,
    thresholds: harnessConfig.partialAutonomy?.thresholds,
    targetLevel: harnessConfig.partialAutonomy?.maxLevel ?? 3,
  });

  let liveResult = null;
  if (l3Apply?.allowed) {
    liveResult = await writeLivePolicyFromConsumer({
      workspaceRoot,
      harnessConfig,
      replayReport,
      now,
    });
  }

  return {
    shadowResult,
    autonomyState: state,
    l3Apply,
    liveResult,
  };
}

export async function runAutonomousLoopCycle({
  workspaceRoot,
  harnessConfig = FIXTURE_HARNESS_CONFIG,
  task = createPromptBackgroundTask(),
  now = () => new Date('2026-06-18T12:00:00.000Z'),
} = {}) {
  const events = [];
  const emitEvent = async (event) => {
    events.push(event);
  };

  const runner = await detectWorkplaceTestRunner(workspaceRoot);
  assertWorkplaceRunner(runner);

  let replayReport = null;
  let autonomyApply = null;
  let feedbackItems = [];
  let coordinatedEvent = null;

  const hookResult = await wrapPostTaskEvolution({
    task,
    emitEvent,
    now,
    runHooks: async ({ emitEvent: hookEmit }) => {
      const replay = await runPostTaskReplayWithPositiveDelta({ workspaceRoot, now });
      replayReport = replay.report;
      await hookEmit({
        type: 'replay.cycle_completed',
        taskId: task.taskId,
        replayReport,
        evidenceOnly: true,
        canPromote: false,
      });

      autonomyApply = await simulatePostTaskAutonomyApply({
        workspaceRoot,
        harnessConfig,
        replayReport,
        autonomyState: accumulateAutonomyEvidence({ replayReport }),
        emitEvent: hookEmit,
        now,
      });

      feedbackItems = buildReplayFeedbackItems({
        latestReplayReport: replayReport,
        longitudinalTrend: replayReport.longitudinalTrend,
      });

      coordinatedEvent = {
        type: 'recursive_evolution.coordinated',
        taskId: task.taskId,
        coordinated: {
          replayReportId: replayReport.reportId,
          aggregateScore: replayReport.aggregateScore,
          autonomyApplied: autonomyApply.shadowResult.applied,
          livePolicyWritten: Boolean(autonomyApply.liveResult),
        },
        evidenceOnly: true,
        canPromote: false,
      };
      await hookEmit(coordinatedEvent);

      return {
        replay: { ran: [{ report: replayReport }] },
        autonomy: autonomyApply,
        feedbackItems,
      };
    },
  });

  const bridgedFeedback = await bridgeReplayFeedback({
    workspaceRoot,
    event: { replayReport },
  });

  const mergedPolicy = await loadRuntimePolicy({ workspaceRoot });
  const runtimeApply = applyRuntimePolicyToHarnessConfig(harnessConfig, mergedPolicy);

  return {
    task,
    events,
    hookResult,
    replayReport,
    autonomyApply,
    feedbackItems,
    bridgedFeedback,
    coordinatedEvent,
    mergedPolicy,
    runtimeApply,
    workplaceRunner: runner,
  };
}

export function resolveSecondTaskHarnessConfig(firstCycleResult, baseHarnessConfig = FIXTURE_HARNESS_CONFIG) {
  return applyRuntimePolicyToHarnessConfig(
    baseHarnessConfig,
    firstCycleResult.mergedPolicy,
  );
}

function assertWorkplaceRunner(runner) {
  if (runner.advisory?.reason === 'placeholder_suite') {
    throw new Error('fixture workplace must expose a real test runner');
  }
}

export function assertAdaptiveSearchBudgetBounded(before, after) {
  const previous = Number(before);
  const next = Number(after);
  if (!Number.isFinite(previous) || !Number.isFinite(next)) {
    throw new Error('adaptive search budget must be numeric');
  }
  if (next < MIN_MAX_ACTIONS_PER_TASK || next > MAX_MAX_ACTIONS_PER_TASK) {
    throw new Error(`adaptive search budget ${next} outside [${MIN_MAX_ACTIONS_PER_TASK}, ${MAX_MAX_ACTIONS_PER_TASK}]`);
  }
  return next !== previous;
}

export {
  FIXTURE_ROOT,
  SHADOW_POLICY_REL,
  LIVE_POLICY_REL,
};
