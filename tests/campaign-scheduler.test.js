import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runDueCampaignSchedules } from '../src/harness-sidecar/meta/campaignScheduler.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-campaign-scheduler-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('scheduler runs due campaigns through campaign runner with evidence-only reports', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const writes = [];
    const runnerCalls = [];

    const result = await runDueCampaignSchedules({
      workspaceRoot,
      schedules: [{
        id: 'weekly-meta',
        campaignId: 'paper_gap_campaign',
        intervalMs: 0,
        maxCycles: 1,
        target: 'meta-harness',
      }],
      campaignRunner: async (input) => {
        runnerCalls.push(input);
        return {
          schemaVersion: 1,
          campaignId: input.campaign.campaignId,
          cycles: [{
            candidate: { candidateId: 'meta_candidate_0', canPromote: true },
            promotion: { evidenceOnly: true, promotionAuthority: false },
          }],
          frontier: [{ candidateId: 'meta_candidate_0' }],
        };
      },
      store: {
        saveReport: async (report) => { writes.push(report); },
        saveScheduleState: async () => {},
      },
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });

    assert.equal(result.ran.length, 1);
    assert.equal(result.ran[0].scheduleId, 'weekly-meta');
    assert.equal(result.ran[0].campaignId, 'paper_gap_campaign');
    assert.equal(runnerCalls[0].campaign.workspaceRoot, workspaceRoot);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].evidenceOnly, true);
    assert.equal(writes[0].canPromote, false);
    assert.equal(writes[0].promotionAuthority, false);
    assert.equal(writes[0].activeWorkspaceMutation, false);
    assert.equal(result.canPromote, false);
  });
});

test('scheduler skips campaigns that are not yet due', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runDueCampaignSchedules({
      workspaceRoot,
      schedules: [{
        id: 'daily-meta',
        campaignId: 'daily_campaign',
        intervalMs: 86_400_000,
        lastRunAt: '2026-06-17T00:00:00.000Z',
      }],
      campaignRunner: async () => {
        throw new Error('campaign runner should not be called');
      },
      store: {
        saveReport: async () => {},
        saveScheduleState: async () => {},
      },
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });

    assert.equal(result.ran.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].scheduleId, 'daily-meta');
    assert.equal(result.skipped[0].reason, 'not_due');
  });
});

test('scheduler strips promotion claims from persisted campaign reports', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const writes = [];

    await runDueCampaignSchedules({
      workspaceRoot,
      schedules: [{
        id: 'claim-strip',
        campaignId: 'claim_campaign',
        intervalMs: 0,
      }],
      campaignRunner: async () => ({
        campaignId: 'claim_campaign',
        cycles: [{
          candidate: {
            candidateId: 'claim_candidate',
            canPromote: true,
            promotionAuthority: true,
            activeWorkspaceMutation: true,
          },
        }],
      }),
      store: {
        saveReport: async (report) => { writes.push(report); },
        saveScheduleState: async () => {},
      },
      now: () => new Date('2026-06-17T00:00:00.000Z'),
    });

    assert.equal(writes[0].cycles[0].candidate.canPromote, false);
    assert.equal(writes[0].cycles[0].candidate.promotionAuthority, false);
    assert.equal(writes[0].cycles[0].candidate.activeWorkspaceMutation, false);
  });
});
