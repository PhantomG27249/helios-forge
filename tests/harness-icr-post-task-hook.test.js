import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { icrStorePaths } from '../src/harness-sidecar/icr/icrEvidenceStore.js';
import { createDeterministicIcrRunners } from '../src/harness-sidecar/icr/icrRuntimeCoordinator.js';
import { runPostTaskIcrHooks } from '../src/harness-sidecar/icr/icrPostTaskHook.js';

async function makeWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'icr-post-task-hook-'));
  return workspaceRoot;
}

test('runPostTaskIcrHooks skips when ICR lane is disabled', async () => {
  const workspaceRoot = await makeWorkspace();
  const events = [];
  try {
    const result = await runPostTaskIcrHooks({
      workspaceRoot,
      harnessConfig: { icr: { enabled: false } },
      task: { taskId: 'task-disabled' },
      emitEvent: (event) => events.push(event),
      runners: createDeterministicIcrRunners(),
    });

    assert.equal(result.ran, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'icr_lane_disabled');
    assert.equal(result.promotionAllowed, false);
    assert.equal(events.length, 0);
    assert.equal(existsSync(icrStorePaths(workspaceRoot).familiesDir), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('runPostTaskIcrHooks persists family and optional rho report when enabled', async () => {
  const workspaceRoot = await makeWorkspace();
  const runners = createDeterministicIcrRunners();
  try {
    const result = await runPostTaskIcrHooks({
      workspaceRoot,
      harnessConfig: {
        icr: {
          enabled: true,
          branchBreadth: 2,
          includeRhoComparison: true,
          suite: { items: [{ taskId: 'case_1' }] },
        },
      },
      task: { taskId: 'task-hook-persist', prompt: 'solve persist task' },
      runners,
      now: runners.now,
    });

    assert.equal(result.ran, true);
    assert.equal(result.skipped, undefined);
    assert.equal(result.promotionAllowed, false);
    assert.ok(result.artifacts.family.familyPath);
    assert.ok(result.artifacts.rhoReport.rhoReportPath);
    assert.equal(result.capabilityInputs.icrEvidence.length, 1);
    assert.equal(result.capabilityInputs.icrEvidence[0].taskId, 'task-hook-persist');
    assert.equal(result.capabilityInputs.icrEvidence[0].rhoReplayComparison.taskId, 'task-hook-persist');

    const familyPath = path.join(workspaceRoot, result.artifacts.family.familyPath);
    const rhoPath = path.join(workspaceRoot, result.artifacts.rhoReport.rhoReportPath);
    assert.equal(existsSync(familyPath), true);
    assert.equal(existsSync(rhoPath), true);

    const family = JSON.parse(await readFile(familyPath, 'utf8'));
    const rhoReport = JSON.parse(await readFile(rhoPath, 'utf8'));
    assert.equal(family.evidenceOnly, true);
    assert.equal(family.promotionAllowed, false);
    assert.equal(rhoReport.promotionAllowed, false);
    assert.equal(family.branch_memory, undefined);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('runPostTaskIcrHooks emits icr.lane_completed with sanitized summary', async () => {
  const workspaceRoot = await makeWorkspace();
  const events = [];
  const runners = createDeterministicIcrRunners();
  try {
    await runPostTaskIcrHooks({
      workspaceRoot,
      harnessConfig: {
        icr: {
          enabled: true,
          branchBreadth: 2,
          maxComputeMultiplier: 40,
        },
      },
      task: { taskId: 'task-hook-event' },
      emitEvent: (event) => events.push(event),
      runners,
      now: runners.now,
    });

    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event.type, 'icr.lane_completed');
    assert.equal(event.taskId, 'task-hook-event');
    assert.equal(event.evidenceOnly, true);
    assert.equal(event.promotionAllowed, false);
    assert.equal(event.canPromote, false);
    assert.equal(event.summary.branchCount, 2);
    assert.equal(['within_limit', 'exceeded'].includes(event.summary.costGateStatus), true);
    assert.equal(event.summary.rhoUpliftHeadline, null);

    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes('branch_memory'), false);
    assert.equal(serialized.includes('critique_records'), false);
    assert.equal(serialized.includes('pqf_records'), false);
    assert.equal(serialized.includes('private memory'), false);
    assert.equal(serialized.includes('privateScore'), false);
    assert.equal(serialized.includes('hidden hypothesis'), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('runPostTaskIcrHooks event includes rho uplift headline when comparison runs', async () => {
  const workspaceRoot = await makeWorkspace();
  const events = [];
  const runners = createDeterministicIcrRunners();
  try {
    await runPostTaskIcrHooks({
      workspaceRoot,
      harnessConfig: {
        icr: {
          enabled: true,
          branchBreadth: 1,
          includeRhoComparison: true,
          suite: { items: [{ taskId: 'case_1' }] },
        },
      },
      task: { taskId: 'task-hook-rho-headline' },
      emitEvent: (event) => events.push(event),
      runners,
      now: runners.now,
    });

    assert.equal(events[0].summary.rhoUpliftHeadline, 'branch_family_beats_best_single');
    assert.equal(JSON.stringify(events[0]).includes('familySummary'), false);
    assert.equal(JSON.stringify(events[0]).includes('upliftMetrics'), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
