import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createIcrRhoCandidateFamily,
  runIcrRhoReplayComparison,
} from '../src/harness-sidecar/icr/icrReplayAdapter.js';

function replayReport(label, {
  preferred = 'candidate',
  scoreDelta = 0.2,
  caseWinRate = 1,
  validationPassRate = 1,
  rerollCount = 2,
} = {}) {
  return {
    groupSize: 1,
    caseCount: 1,
    cases: [{
      caseId: 'case_1',
      baseline: {
        validation: { passedCount: 1, total: 1, passRate: 1, score: 1 },
        consistency: { score: 1, consistent: true },
      },
      candidateFamily: [{
        candidateId: label,
        validation: {
          passed: validationPassRate === 1,
          passedCount: validationPassRate,
          total: 1,
          passRate: validationPassRate,
          score: validationPassRate,
        },
        consistency: { score: validationPassRate, consistent: validationPassRate === 1 },
      }],
      preferences: [{
        candidateId: label,
        preferred,
        scoreDelta,
        candidateScore: scoreDelta + 2,
        baselineScore: 2,
        aggregate: {
          caseWinRate,
          validationPassRate,
          rerollCount,
        },
        blockingEvidence: [],
        promotionAllowed: false,
        authority: 'evidence_only',
      }],
    }],
    familySummary: {
      preferredCandidateId: label,
      promotionAllowed: false,
      authority: 'evidence_only',
      rankings: [{
        candidateId: label,
        preferred,
        scoreDelta,
        candidateScore: scoreDelta + 2,
        preferredCount: preferred === 'candidate' ? 1 : 0,
        caseCount: 1,
        blockingEvidence: [],
        promotionAllowed: false,
        authority: 'evidence_only',
        advisoryOnly: true,
        aggregate: {
          caseWinRate,
          validationPassRate,
          rerollCount,
        },
      }],
    },
  };
}

test('creates RHO candidate-family entries from ICR active candidates', async () => {
  const branchRunner = async ({ candidate, item }) => ({
    status: 'completed',
    compactHandoff: { summary: `${candidate.candidateId}:${item.taskId}`, testsRun: ['node --test'] },
    verifierEvidence: [{ passed: true }],
  });
  const family = createIcrRhoCandidateFamily({
    kind: 'icr_candidate_family',
    lane: 'icr',
    activeCandidates: [
      {
        candidateId: 'icr_candidate_001',
        branchId: 'icr_branch_001',
        text: 'first answer',
        runner: branchRunner,
        visibleMetrics: { score: 0.7 },
      },
      {
        candidateId: 'icr_candidate_002',
        branchId: 'icr_branch_002',
        text: 'second answer',
        visibleMetrics: { score: 0.9 },
      },
    ],
    evidenceOnly: true,
    promotionAllowed: false,
  });

  assert.deepEqual(family.map((entry) => entry.candidateId), [
    'icr_candidate_001',
    'icr_candidate_002',
  ]);
  assert.equal(family[0].candidate.lane, 'icr');
  assert.equal(family[0].candidate.authority, 'evidence_only');
  assert.equal(family[0].candidate.promotionAllowed, false);
  assert.equal(family[0].candidate.text, 'first answer');
  assert.equal(typeof family[0].runner, 'function');

  const rollout = await family[0].runner({
    candidate: family[0].candidate,
    item: { taskId: 'case_alpha' },
  });
  assert.equal(rollout.compactHandoff.summary, 'icr_candidate_001:case_alpha');
});

test('rejects ICR RHO candidates that claim promotion authority', () => {
  assert.throws(
    () => createIcrRhoCandidateFamily({
      kind: 'icr_candidate_family',
      lane: 'icr',
      activeCandidates: [{
        candidateId: 'icr_candidate_promoter',
        branchId: 'icr_branch_promoter',
        text: 'unsafe authority claim',
        promotionAllowed: true,
      }],
      evidenceOnly: true,
      promotionAllowed: false,
    }),
    /ICR record cannot allow promotion/,
  );
});

test('runs replay comparison through RHO batch shape for all required lanes', async () => {
  const calls = [];
  const rhoRunner = async (input) => {
    calls.push(input);
    return replayReport(input.comparisonLabel ?? input.candidate?.candidateId ?? input.candidateFamily?.[0]?.candidateId);
  };

  const result = await runIcrRhoReplayComparison({
    task: { taskId: 'task_compare', prompt: 'solve' },
    suite: { items: [{ taskId: 'case_1' }] },
    config: { groupSize: 2, branchBreadth: 2 },
    rhoRunner,
    runners: {
      bestSingleRunner: async () => ({ status: 'completed' }),
      repeatedSamplingRunner: async () => ({ status: 'completed' }),
      staticCouncilRunner: async () => ({ status: 'completed' }),
      runIcrCandidateFamily: async () => ({
        kind: 'icr_candidate_family',
        lane: 'icr',
        activeCandidates: [
          { candidateId: 'icr_candidate_001', branchId: 'icr_branch_001', text: 'branch one' },
          { candidateId: 'icr_candidate_002', branchId: 'icr_branch_002', text: 'branch two' },
        ],
        besCandidates: [{ candidateId: 'icr_bes_001', text: 'fused answer' }],
        evidenceOnly: true,
        promotionAllowed: false,
      }),
      icrCandidateRunner: async () => ({ status: 'completed' }),
      icrBesFusionRunner: async () => ({ status: 'completed' }),
    },
  });

  assert.deepEqual(calls.map((call) => call.comparisonLabel), [
    'repeated_sampling_baseline',
    'static_council_baseline',
    'icr_branch_family',
    'icr_bes_lane_fusion',
  ]);
  assert.equal(calls.every((call) => call.baselineRunner === result.baseline.runner), true);
  assert.equal(calls.every((call) => call.groupSize === 2), true);
  assert.deepEqual(calls[2].candidateFamily.map((entry) => entry.candidateId), [
    'icr_candidate_001',
    'icr_candidate_002',
  ]);
  assert.deepEqual(result.comparisonOrder, [
    'best_single_baseline',
    'repeated_sampling_baseline',
    'static_council_baseline',
    'icr_branch_family',
    'icr_bes_lane_fusion',
  ]);
  assert.equal(result.authority, 'evidence_only');
  assert.equal(result.promotionAllowed, false);
  assert.equal(result.productionReadiness.ready, false);
});

test('reports ICR regressions against cheaper baselines and keeps production gated', async () => {
  const byLabel = {
    repeated_sampling_baseline: replayReport('repeated_sampling_baseline', {
      scoreDelta: 0.5,
      caseWinRate: 1,
      rerollCount: 2,
    }),
    static_council_baseline: replayReport('static_council_baseline', {
      scoreDelta: 0.3,
      caseWinRate: 1,
      rerollCount: 3,
    }),
    icr_branch_family: replayReport('icr_candidate_001', {
      preferred: 'baseline',
      scoreDelta: -0.2,
      caseWinRate: 0,
      validationPassRate: 0,
      rerollCount: 8,
    }),
    icr_bes_lane_fusion: replayReport('icr_bes_lane_fusion', {
      scoreDelta: 0.1,
      caseWinRate: 0.5,
      rerollCount: 9,
    }),
  };

  const result = await runIcrRhoReplayComparison({
    task: { taskId: 'task_regression' },
    suite: { items: [{ taskId: 'case_1' }] },
    rhoRunner: async (input) => byLabel[input.comparisonLabel],
    runners: {
      bestSingleRunner: async () => ({ status: 'completed' }),
      repeatedSamplingRunner: async () => ({ status: 'completed' }),
      staticCouncilRunner: async () => ({ status: 'completed' }),
      runIcrCandidateFamily: async () => ({
        kind: 'icr_candidate_family',
        lane: 'icr',
        activeCandidates: [{ candidateId: 'icr_candidate_001', branchId: 'icr_branch_001', text: 'branch' }],
        besCandidates: [{ candidateId: 'icr_bes_001', text: 'fused' }],
        evidenceOnly: true,
        promotionAllowed: false,
      }),
      icrCandidateRunner: async () => ({ status: 'completed' }),
      icrBesFusionRunner: async () => ({ status: 'completed' }),
    },
  });

  assert.equal(result.upliftMetrics.icr_branch_family.scoreDelta, -0.2);
  assert.equal(result.upliftMetrics.icr_branch_family.beatsBestSingle, false);
  assert.equal(result.upliftMetrics.icr_branch_family.cheaperBaselineLosses.length, 2);
  assert.equal(result.regressions.some((entry) => (
    entry.comparison === 'icr_branch_family'
      && entry.baseline === 'repeated_sampling_baseline'
      && entry.reason === 'lost_to_cheaper_baseline'
  )), true);
  assert.equal(result.productionReadiness.ready, false);
  assert.equal(result.productionReadiness.blockedReasons.includes('missing_icr_uplift_evidence'), true);
  assert.equal(result.productionReadiness.blockedReasons.includes('evidence_only_lane'), true);
});

test('blocks production evidence when repeated sampling and static council baselines are absent', async () => {
  const result = await runIcrRhoReplayComparison({
    task: { taskId: 'task_missing_required_baselines' },
    suite: { items: [{ taskId: 'case_1' }] },
    rhoRunner: async (input) => replayReport(input.comparisonLabel, {
      scoreDelta: 0.6,
      caseWinRate: 1,
      validationPassRate: 1,
    }),
    runners: {
      bestSingleRunner: async () => ({ status: 'completed' }),
      runIcrCandidateFamily: async () => ({
        kind: 'icr_candidate_family',
        lane: 'icr',
        activeCandidates: [{ candidateId: 'icr_candidate_001', branchId: 'icr_branch_001', text: 'branch' }],
        besCandidates: [{ candidateId: 'icr_bes_001', text: 'fused' }],
        evidenceOnly: true,
        promotionAllowed: false,
      }),
      icrCandidateRunner: async () => ({ status: 'completed' }),
      icrBesFusionRunner: async () => ({ status: 'completed' }),
    },
  });

  assert.equal(Object.hasOwn(result.replayReports, 'repeated_sampling_baseline'), false);
  assert.equal(Object.hasOwn(result.replayReports, 'static_council_baseline'), false);
  assert.equal(result.productionReadiness.ready, false);
  assert.equal(result.productionReadiness.blockedReasons.includes('missing_repeated_sampling_baseline'), true);
  assert.equal(result.productionReadiness.blockedReasons.includes('missing_static_council_baseline'), true);
  assert.equal(result.productionReadiness.blockedReasons.includes('missing_icr_uplift_evidence'), true);
});

test('uses the real RHO replay runner for default ICR and BES-fusion comparison paths', async () => {
  const passingRunner = async ({ candidate }) => ({
    status: 'completed',
    compactHandoff: {
      summary: `${candidate?.candidateId ?? 'baseline'} stable`,
      testsRun: ['node --test'],
    },
    verifierEvidence: [{ passed: true }],
  });

  const result = await runIcrRhoReplayComparison({
    task: { taskId: 'task_real_rho', prompt: 'solve with real replay batch' },
    suite: { items: [{ taskId: 'case_real_rho' }] },
    config: { branchBreadth: 1 },
    runners: {
      bestSingleRunner: async () => ({
        status: 'completed',
        compactHandoff: { summary: 'best single', testsRun: ['node --test'] },
        verifierEvidence: [{ passed: true }],
      }),
      repeatedSamplingRunner: passingRunner,
      staticCouncilRunner: passingRunner,
      runIcrCandidateFamily: async () => ({
        kind: 'icr_candidate_family',
        lane: 'icr',
        activeCandidates: [{
          candidateId: 'icr_candidate_001',
          branchId: 'icr_branch_001',
          text: 'branch answer',
        }],
        besCandidates: [{
          candidateId: 'icr_bes_001',
          text: 'fused branch answer',
          status: 'shadow_only',
        }],
        evidenceOnly: true,
        promotionAllowed: false,
      }),
      icrCandidateRunner: passingRunner,
      besEvaluator: async () => ({ score: 0.8 }),
      besReplayRunner: async () => ({ validation: { passed: true } }),
    },
  });

  assert.equal(result.replayReports.icr_branch_family.cases[0].candidateFamily[0].validation.passed, true);
  assert.equal(result.replayReports.icr_bes_lane_fusion.cases[0].candidateFamily[0].validation.passed, true);
  assert.equal(result.replayReports.icr_bes_lane_fusion.familySummary.authority, 'evidence_only');
  assert.equal(result.productionReadiness.ready, false);
});
