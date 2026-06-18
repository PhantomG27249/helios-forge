import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { writeBackgroundTickRecord } from '../src/harness-sidecar/meta/frontierPersistence.js';

const FIXED_NOW = '2026-06-17T12:00:00.000Z';
const TICK_ID = 'background-20260617T120000000Z';

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-background-tick-writer-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function sampleHookResults() {
  return {
    evidenceOnly: true,
    canPromote: false,
    replay: {
      ran: [{
        scheduleId: 'post-task-background-evolution',
        report: {
          reportId: 'replay-background-1',
          suiteId: 'code-smoke',
          aggregateScore: 0.71,
          generatedAt: FIXED_NOW,
        },
      }],
    },
    campaigns: {
      ran: [{
        scheduleId: 'post-task-campaign-background-evolution',
        report: {
          reportId: 'campaign-background-evolution',
          campaignId: 'campaign-background-evolution',
          generatedAt: FIXED_NOW,
          canPromote: true,
        },
      }],
    },
    coordinated: {
      replayReportCount: 1,
      campaignReportCount: 1,
      canPromote: true,
    },
  };
}

test('writeBackgroundTickRecord persists evidence-only background tick JSON', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const hookResults = sampleHookResults();

    const result = await writeBackgroundTickRecord({
      workspaceRoot,
      tickId: TICK_ID,
      hookResults,
      recordedAt: FIXED_NOW,
    });

    assert.equal(result.tickId, TICK_ID);
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);

    const filePath = path.join(workspaceRoot, '.harness', 'meta', 'background-ticks', `${TICK_ID}.json`);
    const raw = await readFile(filePath, 'utf8');
    const stored = JSON.parse(raw);

    assert.equal(stored.tickId, TICK_ID);
    assert.equal(stored.recordedAt, FIXED_NOW);
    assert.equal(stored.evidenceOnly, true);
    assert.equal(stored.canPromote, false);
    assert.equal(stored.hookResults.replay.ran.length, 1);
    assert.equal(stored.hookResults.campaigns.ran[0].report.canPromote, false);
    assert.equal(stored.hookResults.coordinated.canPromote, false);
  });
});

test('writeBackgroundTickRecord rejects missing workspaceRoot', async () => {
  await assert.rejects(
    () => writeBackgroundTickRecord({ tickId: TICK_ID, hookResults: {} }),
    /workspaceRoot is required/,
  );
});

test('writeBackgroundTickRecord rejects missing tickId', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await assert.rejects(
      () => writeBackgroundTickRecord({ workspaceRoot, hookResults: {} }),
      /tickId is required/,
    );
  });
});
