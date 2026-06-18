import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  appendFrontierDashboardEntry,
  summarizeFrontierFromHistory,
} from '../src/harness-sidecar/meta/frontierPersistence.js';

const FIXED_NOW = '2026-06-17T12:00:00.000Z';

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-frontier-persistence-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function sampleReplayReport(overrides = {}) {
  return {
    reportId: 'replay-task-1',
    suiteId: 'code-smoke',
    generatedAt: FIXED_NOW,
    aggregateScore: 0.72,
    evidenceOnly: true,
    canPromote: false,
    ...overrides,
  };
}

function sampleCampaignReport(overrides = {}) {
  return {
    reportId: 'campaign-task-1',
    campaignId: 'campaign-task-1',
    generatedAt: FIXED_NOW,
    evidenceOnly: true,
    canPromote: false,
    cycles: [{
      cycleIndex: 0,
      cycleId: 'cycle-0',
      candidate: { candidateId: 'post-task-candidate-a' },
      metrics: {
        quality: 0.76,
        safety: 0.92,
        reliability: 0.84,
        cost: 0.36,
        latency: 8,
        maintainability: 0.73,
        visualConfidence: 0.72,
        memoryHealth: 0.8,
        trustRisk: 0.15,
      },
    }],
    ...overrides,
  };
}

test('appendFrontierDashboardEntry appends evidence-only JSONL rows', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const replayReport = sampleReplayReport();
    const campaignReport = sampleCampaignReport();

    const first = await appendFrontierDashboardEntry({
      workspaceRoot,
      replayReport,
      campaignReport,
      recordedAt: FIXED_NOW,
    });

    assert.equal(first.evidenceOnly, true);
    assert.equal(first.canPromote, false);
    assert.equal(first.replayReportId, 'replay-task-1');
    assert.equal(first.campaignReportId, 'campaign-task-1');
    assert.ok(Array.isArray(first.results) && first.results.length >= 1);
    assert.equal(first.results[0].candidateId, 'post-task-candidate-a');

    const secondReplay = sampleReplayReport({
      reportId: 'replay-task-2',
      aggregateScore: 0.78,
    });
    const secondCampaign = sampleCampaignReport({
      reportId: 'campaign-task-2',
      campaignId: 'campaign-task-2',
      cycles: [{
        cycleIndex: 0,
        cycleId: 'cycle-0',
        candidate: { candidateId: 'post-task-candidate-b' },
        metrics: {
          quality: 0.8,
          safety: 0.93,
          reliability: 0.86,
          cost: 0.34,
          latency: 7,
          maintainability: 0.75,
          visualConfidence: 0.74,
          memoryHealth: 0.82,
          trustRisk: 0.12,
        },
      }],
    });

    await appendFrontierDashboardEntry({
      workspaceRoot,
      replayReport: secondReplay,
      campaignReport: secondCampaign,
      recordedAt: '2026-06-17T13:00:00.000Z',
    });

    const jsonlPath = path.join(workspaceRoot, '.harness', 'benchmarks', 'frontier-dashboard.jsonl');
    const raw = await readFile(jsonlPath, 'utf8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 2);

    const parsed = lines.map((line) => JSON.parse(line));
    assert.ok(parsed.every((entry) => entry.evidenceOnly === true));
    assert.ok(parsed.every((entry) => entry.canPromote === false));
    assert.equal(parsed[0].recordedAt, FIXED_NOW);
    assert.equal(parsed[1].replayReportId, 'replay-task-2');
  });
});

test('summarizeFrontierFromHistory rebuilds longitudinal frontier from persisted JSONL', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await appendFrontierDashboardEntry({
      workspaceRoot,
      replayReport: sampleReplayReport(),
      campaignReport: sampleCampaignReport(),
      recordedAt: '2026-06-17T12:00:00.000Z',
    });

    await appendFrontierDashboardEntry({
      workspaceRoot,
      replayReport: sampleReplayReport({
        reportId: 'replay-task-2',
        aggregateScore: 0.78,
      }),
      campaignReport: sampleCampaignReport({
        reportId: 'campaign-task-2',
        campaignId: 'campaign-task-2',
        cycles: [{
          cycleIndex: 0,
          cycleId: 'cycle-0',
          candidate: { candidateId: 'post-task-candidate-a' },
          metrics: {
            quality: 0.8,
            safety: 0.93,
            reliability: 0.86,
            cost: 0.34,
            latency: 7,
            maintainability: 0.75,
            visualConfidence: 0.74,
            memoryHealth: 0.82,
            trustRisk: 0.12,
          },
        }],
      }),
      recordedAt: '2026-06-17T13:00:00.000Z',
    });

    const result = await summarizeFrontierFromHistory({ workspaceRoot });

    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.equal(result.summary.cycleCount, 2);
    assert.equal(result.summary.frontierCount, 1);
    assert.equal(result.history.cycles.length, 2);
    assert.equal(result.history.canPromote, false);

    const improvedRow = result.summary.dashboardRows.find(
      (row) => row.cycleId === result.history.cycles[1].cycleId,
    );
    assert.ok(improvedRow);
    assert.equal(improvedRow.classification, 'improvement');
    assert.equal(improvedRow.canPromote, false);
  });
});

test('summarizeFrontierFromHistory accepts explicit entries without reading workspace', async () => {
  const entries = [{
    schemaVersion: 1,
    evidenceOnly: true,
    canPromote: false,
    recordedAt: FIXED_NOW,
    cycleId: 'cycle-explicit-1',
    suiteId: 'code-smoke',
    replayReportId: 'replay-explicit',
    campaignReportId: 'campaign-explicit',
    results: [{
      candidateId: 'explicit-candidate',
      metrics: {
        quality: 0.7,
        safety: 0.9,
        reliability: 0.8,
        cost: 0.4,
        latency: 10,
        maintainability: 0.7,
        visualConfidence: 0.6,
        memoryHealth: 0.75,
        trustRisk: 0.2,
      },
    }],
  }];

  const result = await summarizeFrontierFromHistory({ entries });

  assert.equal(result.summary.cycleCount, 1);
  assert.equal(result.summary.dashboardRows[0].candidateId, 'explicit-candidate');
  assert.equal(result.summary.dashboardRows[0].classification, 'new');
});
