import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runDueReplaySchedules } from '../src/harness-sidecar/benchmarks/replayScheduler.js';

const fixedNow = () => new Date('2026-06-17T00:00:00.000Z');

function baseSuite() {
  return {
    id: 'code-smoke',
    domains: ['code'],
    cases: [{ id: 'c1', domain: 'code', metricWeights: { quality: 1 } }],
  };
}

function baseRunners() {
  return {
    suiteLoader: async () => baseSuite(),
    baselineRunner: async () => ({ metrics: { quality: 0.5 }, passed: true }),
    candidateRunner: async () => ({ metrics: { quality: 0.6 }, passed: true }),
  };
}

test('scheduler persists evidence-only replay reports', async () => {
  const writes = [];
  const result = await runDueReplaySchedules({
    workspaceRoot: process.cwd(),
    schedules: [{ id: 'weekly-code', suiteId: 'code-smoke', intervalMs: 0 }],
    ...baseRunners(),
    store: {
      saveReport: async (report) => { writes.push(report); },
      saveSnapshot: async () => {},
    },
    now: fixedNow,
  });

  assert.equal(result.ran.length, 1);
  assert.equal(result.ran[0].scheduleId, 'weekly-code');
  assert.equal(result.skipped.length, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].canPromote, false);
  assert.equal(writes[0].promotionEvidenceOnly, true);
  assert.equal(writes[0].scheduleId, 'weekly-code');
});

test('scheduler skips schedules that are not yet due', async () => {
  const writes = [];
  const result = await runDueReplaySchedules({
    workspaceRoot: process.cwd(),
    schedules: [{
      id: 'hourly-code',
      suiteId: 'code-smoke',
      intervalMs: 3_600_000,
      lastRunAt: '2026-06-17T00:30:00.000Z',
    }],
    ...baseRunners(),
    store: {
      saveReport: async (report) => { writes.push(report); },
      saveSnapshot: async () => {},
    },
    now: fixedNow,
  });

  assert.equal(result.ran.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].scheduleId, 'hourly-code');
  assert.equal(result.skipped[0].reason, 'not_due');
  assert.equal(writes.length, 0);
});

test('scheduler runs schedules when interval has elapsed since lastRunAt', async () => {
  const result = await runDueReplaySchedules({
    workspaceRoot: process.cwd(),
    schedules: [{
      id: 'hourly-code',
      suiteId: 'code-smoke',
      intervalMs: 3_600_000,
      lastRunAt: '2026-06-16T23:00:00.000Z',
    }],
    ...baseRunners(),
    now: fixedNow,
  });

  assert.equal(result.ran.length, 1);
  assert.equal(result.ran[0].scheduleId, 'hourly-code');
});

test('scheduler saves dashboard snapshots when store provides saveSnapshot', async () => {
  const snapshots = [];
  const result = await runDueReplaySchedules({
    workspaceRoot: process.cwd(),
    schedules: [{ id: 'weekly-code', suiteId: 'code-smoke', intervalMs: 0 }],
    ...baseRunners(),
    store: {
      saveReport: async () => {},
      saveSnapshot: async (snapshot) => { snapshots.push(snapshot); },
    },
    now: fixedNow,
  });

  assert.equal(result.ran.length, 1);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].evidenceOnly, true);
  assert.equal(snapshots[0].canPromote, false);
  assert.equal(snapshots[0].rho.scheduleId, 'weekly-code');
  assert.equal(typeof snapshots[0].rho.reportId, 'string');
});

test('scheduler passes suite candidates and budget into runReplayCycle', async () => {
  const replayCalls = [];
  const originalRunReplayCycle = (await import('../src/harness-sidecar/benchmarks/replayCycleRunner.js')).runReplayCycle;

  await runDueReplaySchedules({
    workspaceRoot: process.cwd(),
    schedules: [{
      id: 'candidate-replay',
      suiteId: 'code-smoke',
      intervalMs: 0,
      candidates: [{ id: 'candidate-a' }],
    }],
    suiteLoader: async (suiteId) => {
      assert.equal(suiteId, 'code-smoke');
      return baseSuite();
    },
    baselineRunner: async (input) => {
      replayCalls.push({ runner: 'baseline', input });
      return { metrics: { quality: 0.5 }, passed: true };
    },
    candidateRunner: async (input) => {
      replayCalls.push({ runner: 'candidate', input });
      return { metrics: { quality: 0.7 }, passed: true };
    },
    budget: { maxCases: 5, maxCost: 10 },
    now: fixedNow,
  });

  assert.ok(replayCalls.some((call) => call.runner === 'baseline'));
  assert.ok(replayCalls.some((call) => call.runner === 'candidate'));
  assert.equal(replayCalls[0].input.suite.id, 'code-smoke');
  assert.notEqual(originalRunReplayCycle, undefined);
});

test('scheduler works without a store', async () => {
  const result = await runDueReplaySchedules({
    workspaceRoot: process.cwd(),
    schedules: [{ id: 'weekly-code', suiteId: 'code-smoke', intervalMs: 0 }],
    ...baseRunners(),
    now: fixedNow,
  });

  assert.equal(result.ran.length, 1);
  assert.equal(result.ran[0].report.canPromote, false);
  assert.equal(result.ran[0].report.promotionEvidenceOnly, true);
});

test('scheduler forces evidence-only flags even if replay runner returns promotion authority', async () => {
  const writes = [];
  await runDueReplaySchedules({
    workspaceRoot: process.cwd(),
    schedules: [{ id: 'weekly-code', suiteId: 'code-smoke', intervalMs: 0 }],
    suiteLoader: async () => baseSuite(),
    baselineRunner: async () => ({
      metrics: { quality: 0.5 },
      passed: true,
      canPromote: true,
      promotionEvidenceOnly: false,
      authority: 'admin',
    }),
    candidateRunner: async () => ({ metrics: { quality: 0.6 }, passed: true }),
    store: {
      saveReport: async (report) => { writes.push(report); },
    },
    now: fixedNow,
  });

  assert.equal(writes[0].canPromote, false);
  assert.equal(writes[0].promotionEvidenceOnly, true);
  assert.equal(writes[0].authority, 'evidence_only');
});
