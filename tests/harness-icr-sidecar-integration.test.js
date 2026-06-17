import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { summarizeCapabilityGoalStatus } from '../src/harness-sidecar/meta/capabilityGoalStatus.js';
import { icrStorePaths } from '../src/harness-sidecar/icr/icrEvidenceStore.js';
import { createDeterministicIcrRunners } from '../src/harness-sidecar/icr/icrRuntimeCoordinator.js';
import { runPostTaskIcrHooks } from '../src/harness-sidecar/icr/icrPostTaskHook.js';
import { buildIcrEvidenceStatus } from '../src/harness-sidecar/icr/icrStatusHandler.js';

async function makeWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), 'icr-sidecar-integration-'));
}

function enabledHarnessConfig(overrides = {}) {
  return {
    icr: {
      enabled: true,
      branchBreadth: 2,
      maxContextTokens: 200,
      maxComputeMultiplier: 40,
      ...overrides.icr,
    },
    productionCapabilities: {
      icrLane: {
        enabled: true,
        mode: 'offline',
        authority: 'evidence_only',
      },
      ...overrides.productionCapabilities,
    },
  };
}

test('ICR sidecar integration: post-task hook persists evidence and surfaces capability status', async () => {
  const workspaceRoot = await makeWorkspace();
  const runners = createDeterministicIcrRunners();
  try {
    const hookResult = await runPostTaskIcrHooks({
      workspaceRoot,
      harnessConfig: enabledHarnessConfig(),
      task: { taskId: 'task-icr-integration', prompt: 'integration task' },
      runners,
      now: runners.now,
    });

    assert.equal(hookResult.ran, true);
    assert.equal(hookResult.promotionAllowed, false);
    assert.ok(existsSync(path.join(workspaceRoot, hookResult.artifacts.family.familyPath)));
    assert.ok(existsSync(icrStorePaths(workspaceRoot).latestIndex));

    const index = JSON.parse(await readFile(icrStorePaths(workspaceRoot).latestIndex, 'utf8'));
    assert.equal(index.evidenceOnly, true);
    assert.equal(index.entries[0].taskId, 'task-icr-integration');

    const evidenceStatus = await buildIcrEvidenceStatus({
      workspaceRoot,
      harnessConfig: enabledHarnessConfig(),
    });
    assert.equal(evidenceStatus.type, 'icrStatus');
    assert.equal(evidenceStatus.canPromote, false);
    assert.equal(evidenceStatus.evidenceOnly, true);
    assert.equal(evidenceStatus.summary.available, true);
    assert.equal(evidenceStatus.summary.latestTaskId, 'task-icr-integration');
    assert.equal(evidenceStatus.items.length >= 1, true);
    assert.equal(evidenceStatus.items[0].promotionAllowed, false);

    const capabilityStatus = summarizeCapabilityGoalStatus({
      icrEvidence: hookResult.capabilityInputs.icrEvidence,
      icrConfig: hookResult.capabilityInputs.icrConfig,
    });
    const goal = capabilityStatus.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
    assert.ok(goal);
    assert.equal(goal.canPromote, false);
    assert.equal(goal.level4ReadyCandidate, false);
    assert.equal(goal.blockers.includes('missing_icr_rho_uplift_report'), true);
    assert.equal(goal.blockers.includes('icr_production_replay_missing'), true);
    assert.equal(capabilityStatus.icrDashboardRows.length, 1);
    assert.equal(capabilityStatus.icrDashboardRows[0].kind, 'icr_dashboard_evidence_summary');
    assert.equal(capabilityStatus.icrDashboardRows[0].branchCount, 2);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('ICR sidecar integration: rho report merge updates capability blockers but not level four readiness', async () => {
  const workspaceRoot = await makeWorkspace();
  const runners = createDeterministicIcrRunners();
  try {
    const hookResult = await runPostTaskIcrHooks({
      workspaceRoot,
      harnessConfig: enabledHarnessConfig({
        icr: {
          includeRhoComparison: true,
          suite: { items: [{ taskId: 'case_1' }] },
        },
      }),
      task: { taskId: 'task-icr-rho-merge' },
      runners,
      now: runners.now,
    });

    assert.ok(hookResult.artifacts.rhoReport);

    const capabilityStatus = summarizeCapabilityGoalStatus({
      icrEvidence: hookResult.capabilityInputs.icrEvidence,
      icrConfig: hookResult.capabilityInputs.icrConfig,
    });
    const goal = capabilityStatus.goals.find((entry) => entry.goalId === 'icr_test_time_compute');
    assert.equal(goal.level4ReadyCandidate, false);
    assert.equal(goal.blockers.includes('icr_production_replay_missing'), true);
    assert.equal(goal.missingEvidence.includes('icr_production_replay'), true);
    assert.equal(capabilityStatus.icrDashboardRows.length, 1);

    const evidenceStatus = await buildIcrEvidenceStatus({
      workspaceRoot,
      harnessConfig: enabledHarnessConfig({
        icr: {
          includeRhoComparison: true,
          suite: { items: [{ taskId: 'case_1' }] },
        },
      }),
    });
    assert.equal(evidenceStatus.summary.itemCount >= 2, true);
    assert.equal(evidenceStatus.summary.rhoRegressionCount, 0);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
