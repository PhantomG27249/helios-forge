import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  applyHarnessFeedbackToPrompt,
  createHarnessFeedbackBuffer,
  HIGH_SIGNAL_EVENT_TYPES,
  summarizeHarnessEvent,
} from '../src/harness/harnessFeedbackContext.js';
import {
  bridgeReplayFeedback,
  buildReplayFeedbackItems,
  loadLatestReplayReport,
} from '../src/harness-sidecar/meta/replayFeedbackBridge.js';

test('buildReplayFeedbackItems produces replay and trend summaries', () => {
  const items = buildReplayFeedbackItems({
    latestReplayReport: {
      reportId: 'replay-cycle-suite-a',
      suiteId: 'workplace-smoke',
      aggregateScore: 0.12,
      regressions: [],
    },
    longitudinalTrend: {
      classification: 'improvement',
      latestImprovementDelta: 0.12,
    },
  });

  assert.ok(items.length >= 1);
  assert.ok(items.every((item) => typeof item.summary === 'string' && item.summary.length > 0));
  assert.match(items[0].summary, /replay-cycle-suite-a/);
  assert.match(items[0].summary, /delta 0\.12/);
  assert.match(items[0].summary, /improvement/);
});

test('buildReplayFeedbackItems adds regression warning when regressions present', () => {
  const items = buildReplayFeedbackItems({
    latestReplayReport: {
      reportId: 'replay-regressed',
      suiteId: 'workplace-smoke',
      aggregateScore: -0.05,
      regressions: [{ caseId: 'case_a' }, { caseId: 'case_b' }],
    },
    longitudinalTrend: {
      classification: 'regression',
      latestImprovementDelta: -0.05,
    },
  });

  assert.equal(items.length, 2);
  assert.match(items[1].summary, /regression warning/i);
  assert.match(items[1].summary, /2 replay regression/);
});

test('HIGH_SIGNAL_EVENT_TYPES includes replay and autonomy events', () => {
  assert.equal(HIGH_SIGNAL_EVENT_TYPES.has('replay.cycle_completed'), true);
  assert.equal(HIGH_SIGNAL_EVENT_TYPES.has('recursive_evolution.coordinated'), true);
  assert.equal(HIGH_SIGNAL_EVENT_TYPES.has('partial_autonomy.applied'), true);
});

test('summarizes replay, recursive evolution, and partial autonomy events', () => {
  assert.match(
    summarizeHarnessEvent({
      type: 'replay.cycle_completed',
      taskId: 'task_1',
      ran: [{ scheduleId: 'post-task-task_1' }],
      skipped: [],
    }),
    /task_1 replay cycle completed/,
  );

  assert.match(
    summarizeHarnessEvent({
      type: 'recursive_evolution.coordinated',
      taskId: 'task_2',
      coordinated: { replay: { ran: 1 } },
    }),
    /task_2 recursive evolution coordinated/,
  );

  assert.match(
    summarizeHarnessEvent({
      type: 'partial_autonomy.applied',
      taskId: 'task_3',
      replayReportId: 'replay-cycle-suite-a',
    }),
    /task_3 partial autonomy applied/,
  );
});

test('applyHarnessFeedbackToPrompt includes replay delta and regression warning', () => {
  const feedback = createHarnessFeedbackBuffer();
  const replayFeedback = buildReplayFeedbackItems({
    latestReplayReport: {
      reportId: 'replay-cycle-suite-a',
      suiteId: 'workplace-smoke',
      aggregateScore: -0.08,
      regressions: [{ caseId: 'case_a' }],
    },
    longitudinalTrend: {
      classification: 'regression',
      latestImprovementDelta: -0.08,
    },
  });

  const prompt = applyHarnessFeedbackToPrompt({
    message: 'what changed?',
    feedback,
    replayFeedback,
  });

  assert.match(prompt, /delta -0\.08/);
  assert.match(prompt, /regression warning/i);
});

test('model-visible replay feedback fields pass through quarantine helper', () => {
  const items = buildReplayFeedbackItems({
    latestReplayReport: {
      reportId: 'replay-secret',
      suiteId: 'workplace-smoke',
      aggregateScore: 0.1,
      artifactPath: 'C:\\Users\\jackj\\secret\\trace.json',
      nested: {
        prompt: 'token=ghp_should_not_leak',
      },
      regressions: [],
    },
    longitudinalTrend: {
      classification: 'improvement',
      latestImprovementDelta: 0.1,
    },
  });

  const serialized = JSON.stringify(items);
  assert.equal(serialized.includes('ghp_should_not_leak'), false);
  assert.equal(serialized.includes('C:\\Users\\jackj\\secret'), false);
  assert.ok(items.every((item) => item.evidenceOnly === true && item.canPromote === false));
});

test('loadLatestReplayReport reads newest report from replay-cycles directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-replay-bridge-'));
  const replayDir = path.join(workspaceRoot, '.harness', 'benchmarks', 'replay-cycles');
  await mkdir(replayDir, { recursive: true });

  await writeFile(
    path.join(replayDir, 'older.json'),
    `${JSON.stringify({
      reportId: 'older-report',
      generatedAt: '2026-06-01T00:00:00.000Z',
      aggregateScore: 0.01,
    })}\n`,
  );
  await writeFile(
    path.join(replayDir, 'newer.json'),
    `${JSON.stringify({
      reportId: 'newer-report',
      generatedAt: '2026-06-18T12:00:00.000Z',
      aggregateScore: 0.25,
      longitudinalTrend: {
        classification: 'improvement',
        latestImprovementDelta: 0.25,
      },
    })}\n`,
  );

  const latest = await loadLatestReplayReport({ workspaceRoot });
  assert.equal(latest.reportId, 'newer-report');
  assert.equal(latest.aggregateScore, 0.25);
});

test('bridgeReplayFeedback prefers in-memory event payload over disk', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-replay-bridge-event-'));
  const replayDir = path.join(workspaceRoot, '.harness', 'benchmarks', 'replay-cycles');
  await mkdir(replayDir, { recursive: true });
  await writeFile(
    path.join(replayDir, 'disk-only.json'),
    `${JSON.stringify({ reportId: 'disk-only', aggregateScore: 0.01 })}\n`,
  );

  const items = await bridgeReplayFeedback({
    workspaceRoot,
    event: {
      type: 'replay.cycle_completed',
      replayReport: {
        reportId: 'event-report',
        suiteId: 'workplace-smoke',
        aggregateScore: 0.4,
        regressions: [],
      },
      longitudinalTrend: {
        classification: 'improvement',
        latestImprovementDelta: 0.4,
      },
    },
  });

  assert.match(items[0].summary, /event-report/);
  assert.match(items[0].summary, /delta 0\.4/);
});
