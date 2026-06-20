import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildPromotionCandidateFromEvidence,
  runPostTaskPromotionBridge,
} from '../src/harness-sidecar/meta/postTaskPromotionBridge.js';

const L4_THRESHOLDS = {
  minRollbackDrillsPassed: 1,
  maxRegressionCount: 0,
  minDashboardDepth: 1,
};

const FIXED_NOW = new Date('2026-06-20T12:00:00.000Z');

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-post-task-promotion-bridge-'));
  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

const eligibleAutonomyState = {
  rollbackDrills: { total: 2, passed: 2, failed: 0 },
  regressionCount: 0,
  dashboardDepth: 2,
  dashboardSnapshotIds: ['snap-1', 'snap-2'],
};

const enabledConfig = {
  productionCapabilities: {
    productionAutonomyPolicy: { enabled: true },
  },
  partialAutonomy: {
    thresholds: L4_THRESHOLDS,
  },
  evolution: {
    baselineFrontier: [
      { candidateId: 'baseline', quality: 0.8, safety: 0.9, cost: 0.5, latency: 0.4 },
    ],
  },
};

function candidateRun(overrides = {}) {
  return {
    candidateId: 'cand_post_task_001',
    target: 'tool_policy',
    rationale: 'Improve retry policy after replay uplift.',
    patch: { files: [{ path: 'src/harness-sidecar/meta/toolPolicy.js', action: 'update' }] },
    smokePassed: true,
    metrics: {
      quality: 0.91,
      safety: 0.96,
      cost: 0.3,
      latency: 0.2,
    },
    evidence: {
      replay: { passed: true, replayId: 'replay-post-task' },
      verifier: { passed: true, verifierId: 'verifier-post-task' },
      provenance: { traceId: 'task-post-task', artifactId: 'artifact-post-task' },
    },
    rollback: { reversible: true, drillId: 'rollback-post-task' },
    ...overrides,
  };
}

function replayReport(overrides = {}) {
  return {
    reportId: 'replay-post-task-1',
    suiteId: 'workplace-smoke',
    aggregateScore: 0.12,
    regressions: [],
    familySummary: {
      preferredCandidateId: 'cand_replay_winner',
      rankings: [{
        candidateId: 'cand_replay_winner',
        target: 'tool_policy',
        smokePassed: true,
        metrics: { quality: 0.82, safety: 0.94, cost: 0.35, latency: 0.25 },
        evidence: {
          replay: { passed: true },
          verifier: { passed: true },
          provenance: { traceId: 'replay-trace' },
        },
        rollback: { reversible: true, drillId: 'rollback-replay' },
      }],
    },
    ...overrides,
  };
}

function campaignResult(overrides = {}) {
  return {
    campaignId: 'campaign-post-task-1',
    cycles: [{
      candidate: {
        candidateId: 'cand_campaign_winner',
        target: 'tool_policy',
        rationale: 'Campaign-selected improvement.',
        patch: { files: [{ path: 'src/harness-sidecar/meta/toolPolicy.js', action: 'update' }] },
      },
      metrics: { quality: 0.93, safety: 0.97, cost: 0.28, latency: 0.18 },
      preference: { winner: { candidateId: 'cand_campaign_winner' } },
      replayReport: { regressions: [] },
      rollback: { reversible: true, drillId: 'rollback-campaign' },
      evidence: {
        replay: { passed: true },
        verifier: { passed: true },
        provenance: { traceId: 'campaign-trace', artifactId: 'campaign-artifact' },
      },
    }],
    ...overrides,
  };
}

test('buildPromotionCandidateFromEvidence prefers campaign winner over replay winner', () => {
  const candidate = buildPromotionCandidateFromEvidence({
    replayReports: [replayReport()],
    campaignResults: [campaignResult()],
  });

  assert.equal(candidate.candidateId, 'cand_campaign_winner');
  assert.equal(candidate.metrics.quality, 0.93);
});

test('buildPromotionCandidateFromEvidence falls back to replay when no campaign evidence', () => {
  const candidate = buildPromotionCandidateFromEvidence({
    replayReports: [replayReport()],
    campaignResults: [],
  });

  assert.equal(candidate.candidateId, 'cand_replay_winner');
});

test('runPostTaskPromotionBridge skips when productionAutonomyPolicy gate is disabled', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runPostTaskPromotionBridge({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          productionAutonomyPolicy: { enabled: false },
        },
      },
      autonomyState: eligibleAutonomyState,
      replayReports: [replayReport()],
      campaignResults: [campaignResult()],
      now: () => FIXED_NOW,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.equal(result.l4Eligible, false);
    assert.equal(result.proposal, null);
    assert.equal(result.decision, null);
    assert.equal(result.queuePath, null);
  });
});

test('runPostTaskPromotionBridge skips when L4 eligibility is blocked by regressions', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runPostTaskPromotionBridge({
      workspaceRoot,
      harnessConfig: enabledConfig,
      autonomyState: {
        ...eligibleAutonomyState,
        regressionCount: 2,
      },
      replayReports: [replayReport({ regressions: [{ caseId: 'c1' }, { caseId: 'c2' }] })],
      campaignResults: [campaignResult()],
      now: () => FIXED_NOW,
    });

    assert.equal(result.skipped, true);
    assert.equal(result.l4Eligible, false);
    assert.equal(result.canPromote, false);
    assert.equal(result.proposal, null);
    assert.equal(result.queuePath, null);
    assert.equal(result.blockers?.includes('regression_count_exceeded'), true);
  });
});

test('runPostTaskPromotionBridge queues evidence-only proposal when eligible', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runPostTaskPromotionBridge({
      workspaceRoot,
      harnessConfig: enabledConfig,
      autonomyState: eligibleAutonomyState,
      replayReports: [replayReport()],
      campaignResults: [campaignResult()],
      now: () => FIXED_NOW,
    });

    assert.equal(result.skipped, undefined);
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.equal(result.l4Eligible, true);
    assert.equal(result.proposal?.status, 'approval_required');
    assert.equal(result.proposal?.approvalRequired, true);
    assert.equal(result.proposal?.directApplyAllowed, false);
    assert.equal(result.decision?.status, 'rejected');
    assert.equal(result.decision?.reasons.includes('missing_human_approval'), true);
    assert.match(result.queuePath.replace(/\\/g, '/'), /promotion-queue\/proposal_\d+\.json$/);

    const queued = JSON.parse(await readFile(result.queuePath, 'utf8'));
    assert.equal(queued.canPromote, false);
    assert.equal(queued.evidenceOnly, true);
    assert.equal(queued.proposalId, result.proposal.proposalId);
    assert.equal(queued.decision.status, 'rejected');
    assert.equal(queued.l4Eligible, true);
  });
});

test('runPostTaskPromotionBridge never auto-applies and always evaluates with empty approvals', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const strongCandidate = candidateRun({
      candidateId: 'cand_would_promote_with_approval',
    });

    const result = await runPostTaskPromotionBridge({
      workspaceRoot,
      harnessConfig: enabledConfig,
      autonomyState: eligibleAutonomyState,
      replayReports: [],
      campaignResults: [{
        campaignId: 'campaign-strong',
        cycles: [{
          candidate: {
            candidateId: strongCandidate.candidateId,
            target: strongCandidate.target,
            rationale: strongCandidate.rationale,
            patch: strongCandidate.patch,
          },
          metrics: strongCandidate.metrics,
          evidence: strongCandidate.evidence,
          rollback: strongCandidate.rollback,
          smokePassed: true,
        }],
      }],
      now: () => FIXED_NOW,
    });

    assert.equal(result.canPromote, false);
    assert.equal(result.decision.status, 'rejected');
    assert.equal(result.decision.reasons.includes('missing_human_approval'), true);

    const queued = JSON.parse(await readFile(result.queuePath, 'utf8'));
    assert.equal(queued.canPromote, false);
    assert.equal(queued.applied, undefined);
  });
});
