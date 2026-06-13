import { runBesLaneRuntime } from '../bes/laneRuntime.js';
import { runRhoReplayBatch } from '../rho/replayBatchRunner.js';
import { runIcrCandidateFamily } from './icrCandidateFamily.js';
import { assertIcrEvidenceOnly } from './icrContracts.js';
import { buildIcrSolutionPool } from './icrSolutionPool.js';

const COMPARISON_LABELS = Object.freeze({
  bestSingle: 'best_single_baseline',
  repeatedSampling: 'repeated_sampling_baseline',
  staticCouncil: 'static_council_baseline',
  icrFamily: 'icr_branch_family',
  icrBesFusion: 'icr_bes_lane_fusion',
});

const CHEAPER_BASELINES = Object.freeze([
  COMPARISON_LABELS.repeatedSampling,
  COMPARISON_LABELS.staticCouncil,
]);

const REQUIRED_UPLIFT_COMPARISONS = Object.freeze([
  COMPARISON_LABELS.repeatedSampling,
  COMPARISON_LABELS.staticCouncil,
  COMPARISON_LABELS.icrFamily,
  COMPARISON_LABELS.icrBesFusion,
]);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cloneJson(value, fallback = undefined) {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function taskIdFrom(task = {}) {
  return normalizeId(task.taskId ?? task.id ?? task.name, 'icr_rho_task');
}

function coresetFromSuite(suite = {}, task = {}) {
  if (Array.isArray(suite)) return { items: suite };
  const items = asArray(suite.items ?? suite.cases ?? suite.traces);
  if (items.length > 0) return { ...suite, items };
  return {
    ...suite,
    items: [{
      taskId: taskIdFrom(task),
      ...cloneJson(task, {}),
    }],
  };
}

function textFromCandidate(candidate = {}) {
  const value = candidate.text
    ?? candidate.solution?.text
    ?? candidate.solution?.answer
    ?? candidate.finalCandidate?.text
    ?? candidate.finalCandidate
    ?? candidate.answer
    ?? candidate.compactHandoff?.summary
    ?? '';
  return String(value ?? '');
}

function visibleMetricsFrom(candidate = {}) {
  return cloneJson(candidate.visibleMetrics ?? candidate.metrics ?? {}, {});
}

function defaultIcrCandidateRunner({ candidate = {} } = {}) {
  const metrics = visibleMetricsFrom(candidate);
  const passed = candidate.status !== 'failed' && candidate.passed !== false && metrics.passed !== false;
  return {
    status: passed ? 'completed' : 'failed',
    compactHandoff: {
      summary: textFromCandidate(candidate) || normalizeId(candidate.candidateId, 'icr_candidate'),
      testsRun: passed
        ? ['icr_rho_replay_default_evidence']
        : [{ command: 'icr_rho_replay_default_evidence', status: 'failed', passed: false }],
    },
    verifierEvidence: [{ passed }],
    metrics,
    authority: 'evidence_only',
    promotionAllowed: false,
  };
}

function assertNoPromotionClaim(candidate = {}) {
  if (candidate.evidenceOnly === false) {
    throw new Error('ICR record must be evidence-only');
  }
  if (candidate.promotionAllowed === true || candidate.canPromote === true || candidate.promotion?.allowed === true) {
    throw new Error('ICR record cannot allow promotion');
  }
  if (candidate.authority !== undefined && candidate.authority !== 'evidence_only') {
    throw new Error('ICR record authority must be evidence_only');
  }
}

function sourceCandidatesFrom(record = {}) {
  const rhoFamily = asArray(record.rhoCandidateFamily);
  if (rhoFamily.length > 0) {
    return rhoFamily.map((entry) => ({
      ...entry,
      ...(entry.candidate && typeof entry.candidate === 'object' ? entry.candidate : {}),
      runner: entry.runner ?? entry.candidateRunner ?? entry.candidate?.runner,
    }));
  }

  const activeCandidates = asArray(record.activeCandidates);
  if (activeCandidates.length > 0) return activeCandidates;

  const candidates = asArray(record.candidates).filter((candidate) => candidate?.active !== false);
  if (candidates.length > 0) return candidates;

  const branchTraces = asArray(record.branchTraces);
  if (branchTraces.length > 0) {
    return buildIcrSolutionPool({ branchTraces }).candidates.filter((candidate) => candidate.active !== false);
  }

  return [];
}

function normalizeIcrRhoCandidate(candidate = {}, index, fallbackRunner) {
  assertNoPromotionClaim(candidate);
  const candidateId = normalizeId(candidate.candidateId ?? candidate.id, `icr_candidate_${index + 1}`);
  const branchId = normalizeId(candidate.branchId ?? candidate.branch?.branchId, `icr_branch_${index + 1}`);
  const runner = candidate.runner ?? candidate.candidateRunner ?? fallbackRunner ?? defaultIcrCandidateRunner;
  const normalizedCandidate = {
    ...cloneJson(candidate, {}),
    candidateId,
    branchId,
    lane: 'icr',
    text: textFromCandidate(candidate),
    visibleMetrics: visibleMetricsFrom(candidate),
    evidenceOnly: true,
    promotionAllowed: false,
    canPromote: false,
    authority: 'evidence_only',
  };
  assertIcrEvidenceOnly(normalizedCandidate);
  return {
    candidateId,
    candidate: normalizedCandidate,
    runner,
  };
}

export function createIcrRhoCandidateFamily(record = {}, options = {}) {
  const evidenceRecord = {
    ...record,
    evidenceOnly: record.evidenceOnly ?? true,
    promotionAllowed: record.promotionAllowed ?? false,
    authority: record.authority ?? 'evidence_only',
  };
  assertIcrEvidenceOnly(evidenceRecord);

  return sourceCandidatesFrom(record).map((candidate, index) => (
    normalizeIcrRhoCandidate(candidate, index, options.runner ?? options.defaultRunner)
  ));
}

function bestRanking(report = {}) {
  return report.familySummary?.rankings?.[0] ?? null;
}

function summarizeReport(report = {}) {
  const ranking = bestRanking(report) ?? {};
  const aggregate = ranking.aggregate ?? {};
  return {
    preferredCandidateId: report.familySummary?.preferredCandidateId ?? ranking.candidateId ?? null,
    scoreDelta: Number(ranking.scoreDelta ?? 0),
    candidateScore: Number(ranking.candidateScore ?? 0),
    caseWinRate: Number(aggregate.caseWinRate ?? 0),
    validationPassRate: Number(aggregate.validationPassRate ?? 0),
    rerollCount: Number(aggregate.rerollCount ?? 0),
    blockingEvidence: asArray(ranking.blockingEvidence).map(String).sort(),
    beatsBestSingle: ranking.preferred === 'candidate' && Number(ranking.scoreDelta ?? 0) > 0,
    promotionAllowed: false,
    authority: 'evidence_only',
  };
}

function summarizeBaselineReplay(report = {}) {
  const cases = asArray(report.cases);
  const total = cases.reduce((sum, entry) => sum + Number(entry.baseline?.validation?.total ?? 0), 0);
  const passed = cases.reduce((sum, entry) => sum + Number(entry.baseline?.validation?.passedCount ?? 0), 0);
  return {
    preferredCandidateId: COMPARISON_LABELS.bestSingle,
    scoreDelta: 0,
    candidateScore: 0,
    caseWinRate: 0,
    validationPassRate: total > 0 ? Number((passed / total).toFixed(12)) : 0,
    rerollCount: cases.reduce((sum, entry) => sum + Number(entry.baseline?.rerollCount ?? 0), 0),
    blockingEvidence: [],
    beatsBestSingle: false,
    promotionAllowed: false,
    authority: 'evidence_only',
  };
}

function cheaperBaselineLosses(label, metricsByLabel) {
  const current = metricsByLabel[label];
  if (!current) return [];
  return CHEAPER_BASELINES
    .map((baseline) => [baseline, metricsByLabel[baseline]])
    .filter(([, baselineMetrics]) => baselineMetrics)
    .filter(([, baselineMetrics]) => (
      current.scoreDelta < baselineMetrics.scoreDelta
        || current.caseWinRate < baselineMetrics.caseWinRate
        || current.validationPassRate < baselineMetrics.validationPassRate
    ))
    .map(([baseline, baselineMetrics]) => ({
      baseline,
      scoreDeltaGap: Number((current.scoreDelta - baselineMetrics.scoreDelta).toFixed(12)),
      caseWinRateGap: Number((current.caseWinRate - baselineMetrics.caseWinRate).toFixed(12)),
      validationPassRateGap: Number((current.validationPassRate - baselineMetrics.validationPassRate).toFixed(12)),
    }));
}

function collectRegressions(metricsByLabel) {
  const regressions = [];
  for (const label of [COMPARISON_LABELS.icrFamily, COMPARISON_LABELS.icrBesFusion]) {
    const metrics = metricsByLabel[label];
    if (!metrics) continue;
    if (!metrics.beatsBestSingle) {
      regressions.push({
        comparison: label,
        baseline: COMPARISON_LABELS.bestSingle,
        reason: 'did_not_beat_best_single',
        scoreDelta: metrics.scoreDelta,
      });
    }
    for (const loss of metrics.cheaperBaselineLosses ?? []) {
      regressions.push({
        comparison: label,
        baseline: loss.baseline,
        reason: 'lost_to_cheaper_baseline',
        ...loss,
      });
    }
  }
  return regressions;
}

function productionReadinessFrom(metricsByLabel, regressions, replayReports = {}) {
  const blockers = new Set(['evidence_only_lane']);
  const missingComparisons = REQUIRED_UPLIFT_COMPARISONS
    .filter((label) => !replayReports[label] || !metricsByLabel[label]);
  for (const label of missingComparisons) {
    blockers.add(`missing_${label}`);
  }
  const icrMetrics = [metricsByLabel[COMPARISON_LABELS.icrFamily], metricsByLabel[COMPARISON_LABELS.icrBesFusion]];
  const hasCompleteComparisonSet = missingComparisons.length === 0;
  const hasUplift = hasCompleteComparisonSet
    && icrMetrics.every((metrics) => (
      metrics?.beatsBestSingle === true
        && Number(metrics.scoreDelta ?? 0) > 0
        && metrics.cheaperBaselineLosses.length === 0
    ));
  if (!hasUplift) blockers.add('missing_icr_uplift_evidence');
  if (regressions.length > 0) blockers.add('icr_regression_against_baseline');

  return {
    ready: false,
    blockedReasons: [...blockers].sort((left, right) => left.localeCompare(right)),
    requiredEvidence: [
      'heldout_rho_replay_uplift',
      'beats_best_single_baseline',
      'beats_repeated_sampling_baseline',
      'beats_static_council_baseline',
      'bes_lane_fusion_uplift',
    ],
    authority: 'evidence_only',
    promotionAllowed: false,
  };
}

async function defaultBesFusionRunner({ task, icrFamily, runners, config }) {
  if (typeof runners.runIcrBesFusion === 'function') {
    return toBesFusionRollout(await runners.runIcrBesFusion({ task, icrFamily, config, runners }));
  }
  const candidates = asArray(icrFamily.besCandidates);
  if (candidates.length === 0) {
    return toBesFusionRollout({
      candidateId: 'icr_bes_lane_fusion',
      text: asArray(icrFamily.activeCandidates)[0]?.text ?? '',
      lane: 'icr',
      evidenceOnly: true,
      promotionAllowed: false,
    });
  }
  const result = await runBesLaneRuntime({
    lane: 'icr',
    taskId: taskIdFrom(task),
    candidates,
    evaluator: runners.besEvaluator,
    replayRunner: runners.besReplayRunner,
  });
  return toBesFusionRollout(result.candidates?.[0] ?? candidates[0]);
}

function toBesFusionRollout(candidate = {}) {
  if (
    candidate.status === 'completed'
      && (candidate.compactHandoff || candidate.verifierEvidence || candidate.testsRun)
  ) {
    return candidate;
  }
  const metrics = {
    ...(candidate.metrics ?? {}),
    ...(candidate.evidence?.summary ?? {}),
  };
  const passed = candidate.evidence?.hasRequiredEvidence !== false
    && candidate.promotion?.allowed !== true
    && candidate.promotionAllowed !== true;
  return {
    status: passed ? 'completed' : 'failed',
    compactHandoff: {
      summary: textFromCandidate(candidate) || normalizeId(candidate.candidateId, 'icr_bes_lane_fusion'),
      testsRun: passed
        ? ['icr_bes_lane_fusion_evidence']
        : [{ command: 'icr_bes_lane_fusion_evidence', status: 'failed', passed: false }],
    },
    verifierEvidence: [{ passed }],
    metrics,
    authority: 'evidence_only',
    promotionAllowed: false,
  };
}

function buildBesFusionCandidate({ icrFamily, runner }) {
  const firstBesCandidate = asArray(icrFamily.besCandidates)[0] ?? {};
  return [{
    candidateId: 'icr_bes_lane_fusion',
    candidate: {
      ...cloneJson(firstBesCandidate, {}),
      candidateId: 'icr_bes_lane_fusion',
      lane: 'icr',
      text: textFromCandidate(firstBesCandidate),
      evidenceOnly: true,
      promotionAllowed: false,
      canPromote: false,
      authority: 'evidence_only',
    },
    runner,
  }];
}

async function runComparison({
  comparisonLabel,
  coreset,
  groupSize,
  heldoutVariants,
  baselineRunner,
  candidateFamily,
  rhoRunner,
}) {
  return rhoRunner({
    coreset,
    groupSize,
    heldoutVariants,
    baselineRunner,
    candidateFamily,
    comparisonLabel,
  });
}

export async function runIcrRhoReplayComparison({
  task = {},
  suite = {},
  config = {},
  runners = {},
  rhoRunner = runRhoReplayBatch,
} = {}) {
  if (typeof runners.bestSingleRunner !== 'function') {
    throw new Error('bestSingleRunner must be a function');
  }
  const baselineRunner = runners.bestSingleRunner;
  const coreset = coresetFromSuite(suite, task);
  const groupSize = Math.max(1, Math.floor(Number(config.groupSize ?? suite.groupSize ?? 1) || 1));
  const heldoutVariants = suite.heldoutVariants ?? config.heldoutVariants;
  const runFamily = runners.runIcrCandidateFamily ?? runIcrCandidateFamily;
  const icrFamily = await runFamily({ task, config, runners, now: runners.now });
  const icrCandidateFamily = createIcrRhoCandidateFamily(icrFamily, {
    runner: runners.icrCandidateRunner,
  });
  const replayReports = {};

  if (typeof runners.repeatedSamplingRunner === 'function') {
    replayReports[COMPARISON_LABELS.repeatedSampling] = await runComparison({
      comparisonLabel: COMPARISON_LABELS.repeatedSampling,
      coreset,
      groupSize,
      heldoutVariants,
      baselineRunner,
      candidateFamily: [{
        candidateId: COMPARISON_LABELS.repeatedSampling,
        candidate: { candidateId: COMPARISON_LABELS.repeatedSampling, authority: 'evidence_only', promotionAllowed: false },
        runner: runners.repeatedSamplingRunner,
      }],
      rhoRunner,
    });
  }

  if (typeof runners.staticCouncilRunner === 'function') {
    replayReports[COMPARISON_LABELS.staticCouncil] = await runComparison({
      comparisonLabel: COMPARISON_LABELS.staticCouncil,
      coreset,
      groupSize,
      heldoutVariants,
      baselineRunner,
      candidateFamily: [{
        candidateId: COMPARISON_LABELS.staticCouncil,
        candidate: { candidateId: COMPARISON_LABELS.staticCouncil, authority: 'evidence_only', promotionAllowed: false },
        runner: runners.staticCouncilRunner,
      }],
      rhoRunner,
    });
  }

  replayReports[COMPARISON_LABELS.icrFamily] = await runComparison({
    comparisonLabel: COMPARISON_LABELS.icrFamily,
    coreset,
    groupSize,
    heldoutVariants,
    baselineRunner,
    candidateFamily: icrCandidateFamily,
    rhoRunner,
  });

  const besFusionRunner = runners.icrBesFusionRunner ?? (async (input) => (
    defaultBesFusionRunner({ ...input, task, icrFamily, runners, config })
  ));
  replayReports[COMPARISON_LABELS.icrBesFusion] = await runComparison({
    comparisonLabel: COMPARISON_LABELS.icrBesFusion,
    coreset,
    groupSize,
    heldoutVariants,
    baselineRunner,
    candidateFamily: buildBesFusionCandidate({ icrFamily, runner: besFusionRunner }),
    rhoRunner,
  });

  const upliftMetrics = {
    [COMPARISON_LABELS.bestSingle]: summarizeBaselineReplay(replayReports[COMPARISON_LABELS.icrFamily]),
  };
  for (const [label, report] of Object.entries(replayReports)) {
    upliftMetrics[label] = summarizeReport(report);
  }
  for (const label of [COMPARISON_LABELS.icrFamily, COMPARISON_LABELS.icrBesFusion]) {
    if (upliftMetrics[label]) {
      upliftMetrics[label].cheaperBaselineLosses = cheaperBaselineLosses(label, upliftMetrics);
    }
  }

  const regressions = collectRegressions(upliftMetrics);

  return {
    kind: 'icr_rho_replay_comparison',
    taskId: taskIdFrom(task),
    comparisonOrder: [
      COMPARISON_LABELS.bestSingle,
      COMPARISON_LABELS.repeatedSampling,
      COMPARISON_LABELS.staticCouncil,
      COMPARISON_LABELS.icrFamily,
      COMPARISON_LABELS.icrBesFusion,
    ],
    baseline: {
      label: COMPARISON_LABELS.bestSingle,
      runner: baselineRunner,
    },
    icrCandidateFamily,
    replayReports,
    upliftMetrics,
    regressions,
    productionReadiness: productionReadinessFrom(upliftMetrics, regressions, replayReports),
    authority: 'evidence_only',
    promotionAllowed: false,
  };
}
