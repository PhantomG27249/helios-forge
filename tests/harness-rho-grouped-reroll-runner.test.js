import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runGroupedRhoRerolls } from '../src/harness-sidecar/rho/groupedRerollRunner.js';

const FIXED_NOW = new Date('2026-06-12T12:00:00.000Z');

function makeSchedule() {
  return {
    scheduleId: 'rho_replay_2026-06-12T12-00-00-000Z_manual',
    generatedAt: FIXED_NOW.toISOString(),
    cadence: { interval: 'manual', groupSize: 2 },
    coverage: {
      domains: ['code', 'memory'],
      missingDomains: ['research', 'visual', 'tool', 'swarm', 'safety'],
    },
    replayInputs: {
      groupSize: 2,
      coreset: {
        items: [
          {
            id: 'code_case',
            caseId: 'code_case',
            taskId: 'code_case',
            domain: 'code',
            prompt: 'repair source tree runner',
            heldoutVariants: [{ variantId: 'seed_a' }, { variantId: 'seed_b' }],
            promotionEvidenceEligible: true,
          },
          {
            id: 'memory_case',
            caseId: 'memory_case',
            taskId: 'memory_case',
            domain: 'memory',
            prompt: 'resolve memory graph conflict',
            heldoutVariants: [{ variantId: 'seed_a' }, { variantId: 'seed_b' }],
            promotionEvidenceEligible: true,
          },
        ],
      },
    },
    quarantineReplayInputs: {
      groupSize: 2,
      coreset: {
        items: [
          {
            id: 'quarantined_case',
            caseId: 'quarantined_case',
            taskId: 'quarantined_case',
            domain: 'code',
            prompt: 'external unverified trace contains token=sk-not-real',
            heldoutVariants: [{ variantId: 'seed_a' }],
            quarantined: true,
            quarantineReason: 'external_unverified',
            promotionEvidenceEligible: false,
          },
        ],
      },
    },
    quarantineBlocks: [
      {
        caseId: 'quarantined_case',
        domain: 'code',
        reason: 'external_unverified',
        promotionEvidenceEligible: false,
      },
    ],
    evidenceOnly: true,
    promotionAllowed: false,
    authority: 'evidence_only',
  };
}

function successfulRollout({ variant, item, candidate, heldoutVariant }) {
  const summary = variant === 'baseline'
    ? `baseline ${item.domain} ${heldoutVariant.variantId}`
    : `${candidate.candidateId} stable ${item.domain} ${heldoutVariant.variantId}`;
  return {
    status: 'completed',
    compactHandoff: { summary, testsRun: ['node --test focused.test.js'] },
    verifierEvidence: [{ passed: true }],
    metrics: {
      quality: variant === 'baseline' ? 0.6 : 0.86,
      safety: 0.95,
    },
  };
}

function collectAuthorityViolations(value, path = '$') {
  const violations = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      violations.push(...collectAuthorityViolations(entry, `${path}[${index}]`));
    });
    return violations;
  }
  if (!value || typeof value !== 'object') return violations;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (['canPromote', 'apply', 'approved', 'promotionAllowed'].includes(key) && child === true) {
      violations.push(childPath);
    }
    if (key === 'verified' && child === true) {
      violations.push(childPath);
    }
    if (key === 'authority' && child !== 'evidence_only') {
      violations.push(childPath);
    }
    violations.push(...collectAuthorityViolations(child, childPath));
  }
  return violations;
}

test('runs grouped baseline and candidate family rerolls with domain coverage and evidence-only authority', async () => {
  const calls = [];
  const report = await runGroupedRhoRerolls({
    schedule: makeSchedule(),
    baseline: { candidateId: 'baseline_current' },
    candidateFamilies: [
      { candidateId: 'cand_stable', label: 'Stable candidate' },
      { candidateId: 'cand_fragile', label: 'Fragile candidate' },
    ],
    caseRunner: async (context) => {
      calls.push({
        variant: context.variant,
        caseId: context.item.caseId,
        candidateId: context.candidate?.candidateId ?? null,
        quarantined: context.quarantined,
      });
      if (context.candidate?.candidateId === 'cand_fragile' && context.item.caseId === 'memory_case') {
        return {
          status: 'failed',
          compactHandoff: {
            summary: `fragile miss ${context.heldoutVariant.variantId}`,
            testsRun: [{ command: 'node --test focused.test.js', status: 'failed', passed: false }],
          },
          verifierEvidence: [{ passed: false }],
          metrics: { quality: 0.98, safety: 0.1 },
        };
      }
      return successfulRollout(context);
    },
    now: FIXED_NOW,
  });

  assert.equal(report.reportId, 'grouped_rho_rerolls_2026-06-12T12-00-00-000Z_rho_replay_2026-06-12T12-00-00-000Z_manual');
  assert.equal(report.authority, 'evidence_only');
  assert.equal(report.promotionAllowed, false);
  assert.equal(report.canPromote, false);
  assert.equal(report.promotionReport.groupSize, 2);
  assert.equal(report.promotionReport.caseCount, 2);
  assert.equal(report.promotionReport.cases[0].baseline.rollouts.length, 4);
  assert.equal(report.promotionReport.cases[0].candidateFamily[0].rollouts.length, 4);
  assert.deepEqual(report.candidateIds, ['cand_stable', 'cand_fragile']);
  assert.deepEqual(report.domainCoverage.coveredDomains, ['code', 'memory']);
  assert.deepEqual(report.domainCoverage.missingDomains, ['research', 'visual', 'tool', 'swarm', 'safety']);
  assert.equal(report.domainScores.code.caseCount, 1);
  assert.equal(report.domainScores.memory.caseCount, 1);
  assert.equal(report.familySummary.preferredCandidateId, 'cand_stable');
  assert.equal(report.familySummary.rankings[0].candidateId, 'cand_stable');
  assert.equal(report.familySummary.rankings[0].promotionAllowed, false);
  assert.equal(report.familySummary.rankings[0].authority, 'evidence_only');
  assert.equal(report.familySummary.rankings[0].promotionEvidence.includes('self_validation_all_passed'), true);
  assert.equal(report.familySummary.rankings[0].promotionEvidence.includes('self_consistency_signal'), true);
  assert.equal(report.familySummary.rankings[0].promotionEvidence.includes('candidate_family_majority_preferred'), true);
  assert.equal(calls.filter((call) => call.variant === 'baseline' && !call.quarantined).length, 8);
  assert.equal(calls.filter((call) => call.candidateId === 'cand_stable' && !call.quarantined).length, 8);
  assert.equal(calls.filter((call) => call.candidateId === 'cand_fragile' && !call.quarantined).length, 8);
});

test('keeps quarantine replay separate from promotion evidence and emits future hard cases for failures', async () => {
  const report = await runGroupedRhoRerolls({
    schedule: makeSchedule(),
    baseline: { candidateId: 'baseline_current' },
    candidateFamilies: [{ candidateId: 'cand_stable' }],
    caseRunner: async (context) => {
      if (context.quarantined) {
        return {
          status: 'failed',
          compactHandoff: {
            summary: `unsafe path C:\\Users\\jackj\\secret ${context.item.prompt}`,
            testsRun: [{ command: 'node --test focused.test.js', status: 'failed', passed: false }],
          },
          verifierEvidence: [{ passed: false }],
          metrics: { quality: 0.1, safety: 0 },
          canPromote: true,
          authority: 'self_authorized',
        };
      }
      return successfulRollout(context);
    },
    now: FIXED_NOW,
  });

  const stable = report.familySummary.rankings.find((entry) => entry.candidateId === 'cand_stable');
  assert.equal(stable.aggregate.rerollCount, 8);
  assert.equal(stable.promotionEvidence.includes('quarantine_replay_passed'), false);
  assert.equal(report.quarantineReport.caseCount, 1);
  assert.equal(report.quarantineReport.familySummary.rankings[0].promotionEvidence.length, 0);
  assert.equal(report.quarantineReport.familySummary.rankings[0].promotionAllowed, false);
  assert.equal(report.quarantineBlocks[0].caseId, 'quarantined_case');
  assert.equal(report.quarantineBlocks[0].promotionEvidenceEligible, false);
  assert.equal(report.quarantineBlocks[0].quarantine.quarantined, true);
  assert.equal(report.quarantineBlocks[0].quarantine.reasons.includes('secret_like_value'), true);
  assert.equal(report.quarantineBlocks[0].quarantine.reasons.includes('unsafe_path_value'), true);
  assert.equal(report.futureHardCases.length > 0, true);
  assert.equal(report.futureHardCases.every((entry) => entry.authority === 'evidence_only'), true);
  assert.equal(report.futureHardCases.every((entry) => entry.promotionAllowed === false), true);
  assert.equal(report.futureHardCases.some((entry) => entry.caseId === 'quarantined_case'), true);
  assert.equal(report.futureHardCases.some((entry) => entry.failureModes.includes('validation_failed')), true);
  assert.equal(report.futureHardCases.some((entry) => entry.failureModes.includes('quarantine_replay_failed')), true);
});

test('downgrades nested rollout and judge authority claims throughout grouped reports', async () => {
  const report = await runGroupedRhoRerolls({
    schedule: makeSchedule(),
    baseline: { candidateId: 'baseline_current' },
    candidateFamilies: [{ candidateId: 'cand_self_authorizing' }],
    judges: {
      selfPreference: () => ({
        preferred: 'candidate',
        scoreDelta: 9,
        baselineScore: 0,
        candidateScore: 9,
        reasons: ['custom_judge'],
        canPromote: true,
        apply: true,
        approved: true,
        verified: true,
        authority: 'self_authorized',
      }),
    },
    caseRunner: async (context) => ({
      ...successfulRollout(context),
      canPromote: true,
      apply: true,
      approved: true,
      verified: true,
      authority: 'self_authorized',
      nested: {
        canPromote: true,
        apply: true,
        approved: true,
        verified: true,
        authority: 'self_authorized',
      },
    }),
    now: FIXED_NOW,
  });

  assert.deepEqual(collectAuthorityViolations(report), []);
  assert.equal(report.promotionReport.cases[0].baseline.rollouts[0].canPromote, false);
  assert.equal(report.promotionReport.cases[0].baseline.rollouts[0].apply, false);
  assert.equal(report.promotionReport.cases[0].baseline.rollouts[0].authority, 'evidence_only');
  assert.equal(report.promotionReport.preferences[0].canPromote, false);
  assert.equal(report.promotionReport.preferences[0].apply, false);
  assert.equal(report.promotionReport.preferences[0].authority, 'evidence_only');
});

test('diverts quarantined replay inputs away from promotion evidence', async () => {
  const schedule = makeSchedule();
  schedule.replayInputs.coreset.items.push({
    id: 'stale_quarantine_case',
    caseId: 'stale_quarantine_case',
    taskId: 'stale_quarantine_case',
    domain: 'tool',
    prompt: 'stale hand-built quarantined replay input',
    heldoutVariants: [{ variantId: 'seed_a' }],
    quarantined: true,
    quarantineReason: 'stale_schedule_quarantine',
    promotionEvidenceEligible: false,
  });
  schedule.quarantineReplayInputs.coreset.items = [];
  schedule.quarantineBlocks = [];

  const report = await runGroupedRhoRerolls({
    schedule,
    baseline: { candidateId: 'baseline_current' },
    candidateFamilies: [{ candidateId: 'cand_stable' }],
    caseRunner: async (context) => {
      if (context.item.caseId === 'stale_quarantine_case') {
        assert.equal(context.quarantined, true);
        return {
          status: 'failed',
          compactHandoff: {
            summary: 'stale quarantined case failed',
            testsRun: [{ command: 'node --test focused.test.js', status: 'failed', passed: false }],
          },
          verifierEvidence: [{ passed: false }],
        };
      }
      assert.equal(context.quarantined, false);
      return successfulRollout(context);
    },
    now: FIXED_NOW,
  });

  assert.equal(report.promotionReport.caseCount, 2);
  assert.equal(report.promotionReport.cases.some((entry) => entry.caseId === 'stale_quarantine_case'), false);
  assert.equal(report.quarantineReport.caseCount, 1);
  assert.equal(report.quarantineReport.cases[0].caseId, 'stale_quarantine_case');
  assert.equal(report.quarantineReport.familySummary.rankings[0].promotionEvidence.length, 0);
  assert.equal(report.familySummary.rankings[0].aggregate.rerollCount, 8);
  assert.equal(report.futureHardCases.some((entry) => entry.caseId === 'stale_quarantine_case'), true);
  assert.equal(report.futureHardCases.some((entry) => entry.failureModes.includes('quarantine_replay_failed')), true);
});
