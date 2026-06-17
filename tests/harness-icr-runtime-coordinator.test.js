import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDeterministicIcrRunners,
  icrLaneEnabled,
  runIcrLaneForTask,
} from '../src/harness-sidecar/icr/icrRuntimeCoordinator.js';

test('icrLaneEnabled is false unless harness config explicitly enables ICR', () => {
  assert.equal(icrLaneEnabled({}), false);
  assert.equal(icrLaneEnabled({ icr: { enabled: false } }), false);
  assert.equal(icrLaneEnabled({ icr: { enabled: true } }), true);
});

test('runIcrLaneForTask no-ops when ICR lane is disabled', async () => {
  let branchCalls = 0;
  const result = await runIcrLaneForTask({
    task: { taskId: 'task-disabled' },
    harnessConfig: { icr: { enabled: false } },
    runners: {
      runIcrBranch: async () => {
        branchCalls += 1;
        return {};
      },
    },
  });

  assert.deepEqual(result, {
    skipped: true,
    reason: 'icr_lane_disabled',
    evidenceOnly: true,
    promotionAllowed: false,
  });
  assert.equal(branchCalls, 0);
});

test('runIcrLaneForTask runs candidate family with deterministic fake runners', async () => {
  const runners = createDeterministicIcrRunners();
  const result = await runIcrLaneForTask({
    task: { taskId: 'task-enabled', prompt: 'solve enabled task' },
    harnessConfig: {
      icr: {
        enabled: true,
        branchBreadth: 2,
      },
    },
    runners,
    now: runners.now,
  });

  assert.equal(result.skipped, false);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.promotionAllowed, false);
  assert.equal(result.family.kind, 'icr_candidate_family');
  assert.equal(result.family.taskId, 'task-enabled');
  assert.equal(result.family.branchTraces.length, 2);
  assert.equal(result.rhoReport, undefined);
});

test('runIcrLaneForTask optionally runs RHO replay comparison', async () => {
  const runners = createDeterministicIcrRunners();
  const result = await runIcrLaneForTask({
    task: { taskId: 'task-rho', prompt: 'solve rho task' },
    harnessConfig: {
      icr: {
        enabled: true,
        branchBreadth: 1,
        includeRhoComparison: true,
        suite: { items: [{ taskId: 'case_1' }] },
      },
    },
    runners,
    now: runners.now,
    includeRhoComparison: true,
  });

  assert.equal(result.skipped, false);
  assert.equal(result.rhoReport.kind, 'icr_rho_replay_comparison');
  assert.equal(result.rhoReport.taskId, 'task-rho');
  assert.equal(result.rhoReport.promotionAllowed, false);
  assert.equal(result.rhoReport.authority, 'evidence_only');
});

test('createDeterministicIcrRunners keeps hidden branch internals out of traces', async () => {
  const runners = createDeterministicIcrRunners();
  const result = await runIcrLaneForTask({
    task: { taskId: 'task-hidden' },
    harnessConfig: { icr: { enabled: true, branchBreadth: 1 } },
    runners,
    now: runners.now,
  });

  const trace = result.family.branchTraces[0];
  assert.equal(trace.branch_memory.length > 0, true);
  assert.equal(trace.evidenceOnly, true);
  assert.equal(trace.promotionAllowed, false);
});
