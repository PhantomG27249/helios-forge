import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildProductionGroupedRerollReport,
  runGroupedRhoRerolls,
} from '../src/harness-sidecar/rho/groupedRerollRunner.js';

const FIXED_NOW = new Date('2026-06-17T12:00:00.000Z');

function makeSchedule() {
  return {
    scheduleId: 'rho_production_weekly',
    generatedAt: FIXED_NOW.toISOString(),
    cadence: { interval: 'weekly', groupSize: 2 },
    coverage: {
      domains: ['code', 'memory'],
      missingDomains: ['research'],
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
            heldoutVariants: [{ variantId: 'seed_a' }, { variantId: 'seed_b' }],
            promotionEvidenceEligible: true,
          },
          {
            id: 'memory_case',
            caseId: 'memory_case',
            taskId: 'memory_case',
            domain: 'memory',
            heldoutVariants: [{ variantId: 'seed_a' }, { variantId: 'seed_b' }],
            promotionEvidenceEligible: true,
          },
        ],
      },
    },
    quarantineReplayInputs: { groupSize: 2, coreset: { items: [] } },
    evidenceOnly: true,
    promotionAllowed: false,
    authority: 'evidence_only',
  };
}

function successfulRollout({ variant, item, candidate, heldoutVariant }) {
  return {
    status: 'completed',
    compactHandoff: {
      summary: variant === 'baseline'
        ? `baseline ${item.domain}`
        : `${candidate.candidateId} ${item.domain}`,
    },
    verifierEvidence: [{ passed: true }],
    metrics: { quality: variant === 'baseline' ? 0.6 : 0.86, safety: 0.95 },
  };
}

test('buildProductionGroupedRerollReport emits evidence-only production envelope', async () => {
  const groupedReport = await runGroupedRhoRerolls({
    schedule: makeSchedule(),
    baseline: { candidateId: 'baseline_current' },
    candidateFamilies: [{ candidateId: 'cand_stable' }],
    caseRunner: async (context) => successfulRollout(context),
    now: FIXED_NOW,
  });

  const production = buildProductionGroupedRerollReport({
    groupedReport,
    now: FIXED_NOW,
  });

  assert.equal(production.evidenceType, 'production_grouped_reroll_report');
  assert.equal(production.evidenceOnly, true);
  assert.equal(production.canPromote, false);
  assert.equal(production.promotionEvidenceOnly, true);
  assert.equal(production.authority, 'evidence_only');
  assert.equal(production.scheduleId, 'rho_production_weekly');
  assert.equal(production.reportId, groupedReport.reportId);
  assert.equal(production.groupedReport.reportId, groupedReport.reportId);
  assert.equal(production.groupedReport.canPromote, false);
});

test('buildProductionGroupedRerollReport includes longitudinal trend with improvement deltas', async () => {
  const schedule = makeSchedule();
  const groupedFirst = await runGroupedRhoRerolls({
    schedule,
    baseline: { candidateId: 'baseline_current' },
    candidateFamilies: [{ candidateId: 'cand_stable' }],
    caseRunner: async (context) => {
      if (context.candidate?.candidateId === 'cand_stable' && context.item.caseId === 'memory_case') {
        return {
          status: 'failed',
          compactHandoff: { summary: 'memory miss' },
          verifierEvidence: [{ passed: false }],
          metrics: { quality: 0.2, safety: 0.1 },
        };
      }
      return successfulRollout(context);
    },
    now: FIXED_NOW,
  });
  const firstProduction = buildProductionGroupedRerollReport({
    groupedReport: groupedFirst,
    suiteId: 'rho_production_suite',
    now: FIXED_NOW,
  });

  const groupedSecond = await runGroupedRhoRerolls({
    schedule: {
      ...schedule,
      scheduleId: 'rho_production_weekly_followup',
    },
    baseline: { candidateId: 'baseline_current' },
    candidateFamilies: [{ candidateId: 'cand_stable' }],
    caseRunner: async (context) => successfulRollout(context),
    now: new Date('2026-06-18T12:00:00.000Z'),
  });
  const secondProduction = buildProductionGroupedRerollReport({
    groupedReport: groupedSecond,
    history: firstProduction.longitudinalTrend.history,
    suiteId: 'rho_production_suite',
    now: new Date('2026-06-18T12:00:00.000Z'),
  });

  assert.equal(firstProduction.longitudinalTrend.evidenceType, 'longitudinal_improvement_trend');
  assert.equal(firstProduction.longitudinalTrend.latestImprovementDelta, null);
  assert.equal(firstProduction.longitudinalTrend.recordCount, 1);
  assert.equal(firstProduction.longitudinalTrend.classificationCounts.new, 1);

  assert.equal(secondProduction.longitudinalTrend.recordCount, 2);
  assert.equal(typeof secondProduction.longitudinalTrend.latestImprovementDelta, 'number');
  assert.equal(secondProduction.longitudinalTrend.latestImprovementDelta > 0, true);
  assert.equal(secondProduction.longitudinalTrend.classificationCounts.improvement >= 1, true);
  assert.equal(Array.isArray(secondProduction.longitudinalTrend.candidateFamilyDeltas), true);
  assert.equal(secondProduction.longitudinalTrend.candidateFamilyDeltas[0].candidateId, 'cand_stable');
  assert.equal(typeof secondProduction.longitudinalTrend.candidateFamilyDeltas[0].scoreDelta, 'number');
  assert.equal(secondProduction.longitudinalTrend.domainImprovementDeltas.memory.classification, 'improvement');
  assert.equal(secondProduction.longitudinalTrend.canPromote, false);
});

test('buildProductionGroupedRerollReport forces evidence-only flags on nested grouped output', async () => {
  const groupedReport = await runGroupedRhoRerolls({
    schedule: makeSchedule(),
    baseline: { candidateId: 'baseline_current' },
    candidateFamilies: [{ candidateId: 'cand_stable' }],
    caseRunner: async (context) => ({
      ...successfulRollout(context),
      canPromote: true,
      promotionEvidenceOnly: false,
      authority: 'self_authorized',
    }),
    now: FIXED_NOW,
  });
  groupedReport.canPromote = true;
  groupedReport.promotionEvidenceOnly = false;
  groupedReport.authority = 'self_authorized';

  const production = buildProductionGroupedRerollReport({
    groupedReport,
    now: FIXED_NOW,
  });

  assert.equal(production.canPromote, false);
  assert.equal(production.promotionEvidenceOnly, true);
  assert.equal(production.authority, 'evidence_only');
  assert.equal(production.groupedReport.canPromote, false);
  assert.equal(production.groupedReport.promotionEvidenceOnly, true);
  assert.equal(production.groupedReport.authority, 'evidence_only');
  assert.equal(production.longitudinalTrend.canPromote, false);
});
