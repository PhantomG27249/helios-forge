import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { summarizeCapabilityGoalStatus } from '../src/harness-sidecar/meta/capabilityGoalStatus.js';
import {
  buildCapabilitySignalFromArtifacts,
  loadPersistedProductionSignals,
} from '../src/harness-sidecar/meta/productionEvidenceIndex.js';

const FIXED_NOW = '2026-06-17T12:00:00.000Z';

async function writeJson(workspaceRoot, relativePath, content) {
  const filePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
}

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-production-evidence-index-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function seedProductionArtifacts(workspaceRoot) {
  await writeJson(workspaceRoot, '.harness/benchmarks/replay-cycles/replay-prod.json', {
    reportId: 'replay-prod',
    generatedAt: FIXED_NOW,
    aggregateScore: 0.82,
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/dashboards/operator/operator-prod.json', {
    snapshotId: 'operator-prod',
    createdAt: FIXED_NOW,
    frontier: { status: 'stable', items: [{ id: 'frontier-1' }] },
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/meta/campaign-reports/campaign-prod.json', {
    reportId: 'campaign-prod',
    generatedAt: FIXED_NOW,
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/rho/production-grouped-rerolls/grouped-prod.json', {
    evidenceType: 'production_grouped_reroll_report',
    reportId: 'grouped-prod',
    generatedAt: FIXED_NOW,
    longitudinalTrend: {
      evidenceType: 'longitudinal_improvement_trend',
      history: [{ reportId: 'grouped-prod', aggregateDelta: 0.04 }],
      latestImprovementDelta: 0.04,
    },
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/bes/production-live-lanes/live-prod.json', {
    evidenceType: 'live_lane_report',
    reportId: 'live-prod',
    generatedAt: FIXED_NOW,
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/memory/provenance-resolution/provenance-prod.json', {
    evidenceType: 'provenance_resolution_report',
    reportId: 'provenance-prod',
    generatedAt: FIXED_NOW,
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/visual/production-replay/visual-prod.json', {
    evidenceType: 'visual_replay_report',
    reportId: 'visual-prod',
    generatedAt: FIXED_NOW,
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/a2a/peer-cycles/peer-cycle-prod.json', {
    cycleId: 'peer-cycle-prod',
    completedAt: FIXED_NOW,
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/interop/production-queues.json', {
    generatedAt: FIXED_NOW,
    outbox: [{ messageId: 'msg-1', status: 'queued' }],
    inbox: [],
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/governance/autonomy-summary.json', {
    generatedAt: FIXED_NOW,
    dashboardDepth: 2,
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/governance/rollback-drills.json', {
    generatedAt: FIXED_NOW,
    drills: [{ drillId: 'rollback-1', status: 'passed' }],
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/meta/autonomy-evidence.json', {
    tickId: 'background-20260617T120000000Z',
    lastTickAt: FIXED_NOW,
    evidenceOnly: true,
    canPromote: false,
  });
  await writeJson(workspaceRoot, '.harness/icr/families/family-prod.json', {
    kind: 'icr_candidate_family',
    taskId: 'task-icr-prod',
    candidateFamilyId: 'family-prod',
    branches: [{ kind: 'icr_branch_trace', branchId: 'branch-a' }],
    finalJudgePacket: {
      kind: 'icr_blind_final_judge_packet',
      candidates: [{ candidateId: 'cand-a', branchId: 'branch-a' }],
    },
    config: { maxContextTokens: 140000, maxComputeMultiplier: 40 },
    evidenceOnly: true,
    canPromote: false,
  });
}

function signalFor(signals, goalId) {
  return signals.find((entry) => entry.goalId === goalId);
}

test('loadPersistedProductionSignals returns empty arrays for workspace without harness artifacts', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const loaded = await loadPersistedProductionSignals({ workspaceRoot });

    assert.equal(loaded.canPromote, false);
    assert.equal(loaded.evidenceOnly, true);
    assert.deepEqual(loaded.signals, []);
    assert.deepEqual(loaded.icrEvidence, []);
  });
});

test('loadPersistedProductionSignals maps persisted artifacts to capability goal production evidence', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await seedProductionArtifacts(workspaceRoot);

    const loaded = await loadPersistedProductionSignals({ workspaceRoot });
    const { signals, icrEvidence } = loaded;

    assert.equal(loaded.canPromote, false);
    assert.equal(loaded.evidenceOnly, true);
    assert.equal(icrEvidence.length, 1);
    assert.equal(icrEvidence[0].candidateFamilyId, 'family-prod');

    const benchmark = signalFor(signals, 'benchmark_spine');
    assert.ok(benchmark);
    assert.equal(benchmark.canPromote, false);
    assert.equal(benchmark.persistedProductionEvidence, true);
    assert.deepEqual(benchmark.productionEvidence, [
      'frontier_dashboard_snapshot',
      'operator_dashboard_snapshot',
      'persisted_replay_report',
    ]);
    assert.deepEqual(benchmark.evidence, [
      'budget_accounting',
      'frontier_trend',
      'held_out_suite',
      'repeated_cycle',
    ]);
    assert.deepEqual(benchmark.blockers, []);
    assert.equal(benchmark.updatedAt, FIXED_NOW);

    const metaHarness = signalFor(signals, 'meta_harness_loop');
    assert.deepEqual(metaHarness.productionEvidence, [
      'frontier_dashboard_snapshot',
      'persisted_campaign_report',
    ]);

    const rho = signalFor(signals, 'rho_at_scale');
    assert.deepEqual(rho.productionEvidence, [
      'longitudinal_improvement_trend',
      'production_grouped_reroll_report',
    ]);

    const bes = signalFor(signals, 'bes_full_lanes');
    assert.deepEqual(bes.productionEvidence, ['live_lane_report']);

    const memory = signalFor(signals, 'memgraphrag_depth');
    assert.deepEqual(memory.productionEvidence, ['provenance_resolution_report']);

    const visual = signalFor(signals, 'multimodal_system_sense');
    assert.deepEqual(visual.productionEvidence, ['visual_replay_report']);

    const a2a = signalFor(signals, 'a2a_external_durability');
    assert.deepEqual(a2a.productionEvidence, [
      'durable_queue_snapshot',
      'external_peer_status',
    ]);

    const governance = signalFor(signals, 'governance_autonomy');
    assert.deepEqual(governance.productionEvidence, [
      'autonomy_dashboard_snapshot',
      'rollback_drill_report',
    ]);

    const background = signalFor(signals, 'background_evolution');
    assert.deepEqual(background.productionEvidence, ['background_tick_record']);
  });
});

test('buildCapabilitySignalFromArtifacts can scan workspace directly', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeJson(workspaceRoot, '.harness/benchmarks/replay-cycles/replay-only.json', {
      reportId: 'replay-only',
      generatedAt: FIXED_NOW,
    });

    const signals = await buildCapabilitySignalFromArtifacts({ workspaceRoot });
    const benchmark = signalFor(signals, 'benchmark_spine');

    assert.deepEqual(benchmark.productionEvidence, ['persisted_replay_report']);
    assert.equal(benchmark.persistedProductionEvidence, true);
    assert.equal(benchmark.canPromote, false);
  });
});

test('summarizeCapabilityGoalStatus reflects persisted production evidence completeness', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await seedProductionArtifacts(workspaceRoot);

    const { signals, icrEvidence } = await loadPersistedProductionSignals({ workspaceRoot });
    const status = summarizeCapabilityGoalStatus({ signals, icrEvidence });

    assert.equal(status.canPromote, false);
    assert.equal(status.authority, 'status_evidence_only');

    const governance = status.goals.find((goal) => goal.goalId === 'governance_autonomy');
    assert.deepEqual(governance.productionEvidence, [
      'autonomy_dashboard_snapshot',
      'rollback_drill_report',
    ]);
    assert.deepEqual(governance.missingProductionEvidence, []);

    const rho = status.goals.find((goal) => goal.goalId === 'rho_at_scale');
    assert.deepEqual(rho.productionEvidence, [
      'longitudinal_improvement_trend',
      'production_grouped_reroll_report',
    ]);
    assert.deepEqual(rho.missingProductionEvidence, []);

    const benchmark = status.goals.find((goal) => goal.goalId === 'benchmark_spine');
    assert.deepEqual(benchmark.missingProductionEvidence, []);
    assert.equal(benchmark.status, 'implemented');
    assert.deepEqual(benchmark.missingEvidence, []);

    const metaHarness = status.goals.find((goal) => goal.goalId === 'meta_harness_loop');
    assert.equal(metaHarness.status, 'implemented');
    assert.deepEqual(metaHarness.missingEvidence, []);
  });
});
