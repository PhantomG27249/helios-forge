import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  assertAdaptiveSearchBudgetBounded,
  copyFixtureWorkplace,
  createPromptBackgroundTask,
  FIXTURE_HARNESS_CONFIG,
  FIXTURE_ROOT,
  LIVE_POLICY_REL,
  runAutonomousLoopCycle,
  resolveSecondTaskHarnessConfig,
  SHADOW_POLICY_REL,
} from './fixtures/autonomous-loop-workplace/loopTestHarness.js';
import { detectWorkplaceTestRunner } from '../src/harness-sidecar/benchmarks/workplaceSuiteDetector.js';
import {
  MAX_MAX_ACTIONS_PER_TASK,
  MIN_MAX_ACTIONS_PER_TASK,
} from '../src/harness-sidecar/meta/runtimePolicyConsumer.js';

async function withFixtureWorkplace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-autonomous-loop-'));
  await copyFixtureWorkplace(workspaceRoot);
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('fixture workplace exposes real pass/fail commands via package.json test script', async () => {
  const runner = await detectWorkplaceTestRunner(FIXTURE_ROOT);
  assert.notEqual(runner.advisory?.reason, 'placeholder_suite');
  assert.equal(runner.type, 'npm-test');
  assert.equal(runner.executable, 'npm');
  assert.deepEqual(runner.args, ['test']);
});

test('autonomous self-improvement loop closes from prompt_background through replay, policy, and feedback', async () => {
  await withFixtureWorkplace(async (workspaceRoot) => {
    const task1 = createPromptBackgroundTask('task_loop_1');
    const firstCycle = await runAutonomousLoopCycle({
      workspaceRoot,
      harnessConfig: FIXTURE_HARNESS_CONFIG,
      task: task1,
    });

    assert.equal(firstCycle.task.source, 'prompt_background');
    assert.ok(Number(firstCycle.replayReport.aggregateScore) > 0);
    assert.equal(firstCycle.replayReport.longitudinalTrend?.classification, 'improvement');

    assert.equal(firstCycle.hookResult.coordinatedEmitted, true);
    assert.equal(firstCycle.hookResult.status, 'completed');
    assert.ok(firstCycle.events.some((event) => event.type === 'recursive_evolution.coordinated'));
    assert.ok(firstCycle.events.some((event) => event.type === 'replay.cycle_completed'));
    assert.ok(firstCycle.events.some((event) => event.type === 'partial_autonomy.applied'));

    assert.equal(firstCycle.autonomyApply.shadowResult.applied, true);
    assert.equal(firstCycle.autonomyApply.l3Apply.allowed, true);
    assert.ok(firstCycle.autonomyApply.liveResult);

    await access(path.join(workspaceRoot, SHADOW_POLICY_REL), constants.F_OK);
    await access(path.join(workspaceRoot, LIVE_POLICY_REL), constants.F_OK);

    const shadowPolicy = JSON.parse(
      await readFile(path.join(workspaceRoot, SHADOW_POLICY_REL), 'utf8'),
    );
    const livePolicy = JSON.parse(
      await readFile(path.join(workspaceRoot, LIVE_POLICY_REL), 'utf8'),
    );
    assert.equal(shadowPolicy.policyHints.reportId, firstCycle.replayReport.reportId);
    assert.equal(livePolicy.provenance.replayReportId, firstCycle.replayReport.reportId);
    assert.equal(livePolicy.partialAutonomy.level, 3);

    const baselineBudget = FIXTURE_HARNESS_CONFIG.adaptiveSearch.maxActionsPerTask;
    const adjustedBudget = firstCycle.runtimeApply.harnessConfig.adaptiveSearch.maxActionsPerTask;
    assert.ok(assertAdaptiveSearchBudgetBounded(baselineBudget, adjustedBudget));
    assert.ok(adjustedBudget >= MIN_MAX_ACTIONS_PER_TASK);
    assert.ok(adjustedBudget <= MAX_MAX_ACTIONS_PER_TASK);

    assert.ok(firstCycle.feedbackItems.length >= 1);
    assert.match(firstCycle.feedbackItems[0].summary, /replay/i);
    assert.match(firstCycle.feedbackItems[0].summary, /delta/i);
    assert.ok(firstCycle.bridgedFeedback.length >= 1);
    assert.equal(firstCycle.bridgedFeedback[0].type, 'replay.evidence');

    const task2 = createPromptBackgroundTask('task_loop_2');
    const secondTaskConfig = resolveSecondTaskHarnessConfig(firstCycle);
    const secondBudget = secondTaskConfig.harnessConfig.adaptiveSearch.maxActionsPerTask;

    assert.notEqual(secondBudget, baselineBudget);
    assert.ok(secondBudget >= MIN_MAX_ACTIONS_PER_TASK);
    assert.ok(secondBudget <= MAX_MAX_ACTIONS_PER_TASK);

    const secondCycle = await runAutonomousLoopCycle({
      workspaceRoot,
      harnessConfig: secondTaskConfig.harnessConfig,
      task: task2,
    });

    assert.equal(secondCycle.runtimeApply.harnessConfig.adaptiveSearch.maxActionsPerTask, secondBudget);
    assert.equal(secondCycle.task.source, 'prompt_background');
    assert.ok(secondCycle.events.some((event) => event.type === 'recursive_evolution.coordinated'));
  });
});

test('replay feedback bridge surfaces regression warning when regressions present', async () => {
  await withFixtureWorkplace(async (workspaceRoot) => {
    const firstCycle = await runAutonomousLoopCycle({ workspaceRoot });
    const replayWithRegression = {
      ...firstCycle.replayReport,
      regressions: [{ caseId: 'workplace-fail', domain: 'safety', reasons: ['quality_regression'] }],
    };

    const { buildReplayFeedbackItems } = await import('../src/harness-sidecar/meta/replayFeedbackBridge.js');
    const items = buildReplayFeedbackItems({ latestReplayReport: replayWithRegression });
    assert.ok(items.some((item) => item.type === 'replay.regression_warning'));
  });
});
