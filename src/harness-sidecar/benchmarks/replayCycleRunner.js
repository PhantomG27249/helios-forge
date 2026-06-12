import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

const AUTHORITY_ASSIGNMENT_PATTERN = /\bauthority\s*[:=]\s*(?!evidence_only\b|advisory\b|none\b)[^\s,;'"<>]+/gi;
const CAN_PROMOTE_TRUE_PATTERN = /\bcanPromote\s*[:=]\s*true\b/gi;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cloneJson(value, fallback = undefined) {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundScore(value) {
  return Math.round(numeric(value) * 1_000_000) / 1_000_000;
}

function safeId(value, fallback) {
  const id = String(value ?? fallback).trim();
  return id || fallback;
}

function reportIdPart(value, fallback) {
  return safeId(value, fallback).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function candidateId(candidate, index) {
  return safeId(
    candidate?.id ?? candidate?.candidateId ?? candidate?.attemptId ?? candidate?.policyId,
    `candidate-${index + 1}`,
  );
}

function normalizeQuarantine(value) {
  if (value === undefined || value === null || value === false) {
    return { quarantined: false, reasons: [] };
  }
  if (value === true) {
    return { quarantined: true, reasons: ['quarantined'] };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { quarantined: true, reasons: ['quarantined'] };
  }
  const reasons = asArray(value.reasons)
    .map((reason) => String(reason || '').trim())
    .filter(Boolean);
  return {
    quarantined: value.quarantined === true || reasons.length > 0,
    reasons: reasons.length > 0 ? [...new Set(reasons)].sort() : ['quarantined'],
  };
}

function addQuarantineBlocks(blocks, { scope, id, quarantine }) {
  const normalized = normalizeQuarantine(quarantine);
  if (!normalized.quarantined) return false;

  for (const reason of normalized.reasons) {
    const sanitized = quarantineModelVisiblePayload({
      scope,
      id,
      reason,
    });
    const value = sanitized.value || {};
    blocks.push({
      scope: String(value.scope ?? scope),
      id: String(value.id ?? id),
      reason: String(value.reason ?? reason),
    });
  }
  return true;
}

function stringifyReason(reason) {
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function sanitizeRegressionReason(reason) {
  const quarantined = quarantineModelVisiblePayload({ reason: stringifyReason(reason) }, { maxStringLength: 600 });
  const quarantineReasons = new Set(quarantined.reasons);
  let sanitized = String(quarantined.value?.reason ?? '');

  sanitized = sanitized.replace(AUTHORITY_ASSIGNMENT_PATTERN, (match) => {
    quarantineReasons.add('authority_claim_removed');
    const separator = match.includes(':') ? ':' : '=';
    return `authority${separator}evidence_only`;
  });
  sanitized = sanitized.replace(CAN_PROMOTE_TRUE_PATTERN, (match) => {
    quarantineReasons.add('authority_claim_removed');
    const separator = match.includes(':') ? ':' : '=';
    return `canPromote${separator}false`;
  });

  return {
    reason: sanitized || 'regression_reason_quarantined',
    quarantineReasons: [...quarantineReasons].sort(),
  };
}

function sanitizeRegressionReasons(reasons, { quarantineBlocks, candidateId: id, caseId }) {
  return asArray(reasons).map((reason) => {
    const sanitized = sanitizeRegressionReason(reason);
    if (sanitized.quarantineReasons.length > 0) {
      addQuarantineBlocks(quarantineBlocks, {
        scope: 'regression_reason',
        id: `${id}:${caseId}`,
        quarantine: { quarantined: true, reasons: sanitized.quarantineReasons },
      });
    }
    return sanitized.reason;
  });
}

function metricWeightsFor(replayCase = {}, suite = {}, metrics = {}) {
  const weights = replayCase.metricWeights ?? suite.metricWeights;
  if (weights && typeof weights === 'object' && !Array.isArray(weights) && Object.keys(weights).length > 0) {
    return Object.fromEntries(
      Object.entries(weights)
        .filter(([, weight]) => numeric(weight, -1) >= 0)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  return Object.fromEntries(
    Object.keys(metrics || {})
      .filter((key) => Number.isFinite(Number(metrics[key])))
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, 1]),
  );
}

function scoreResult(result = {}, replayCase = {}, suite = {}) {
  const metrics = result.metrics && typeof result.metrics === 'object' ? result.metrics : {};
  const weights = metricWeightsFor(replayCase, suite, metrics);
  const entries = Object.entries(weights).filter(([, weight]) => numeric(weight, 0) > 0);
  if (entries.length === 0) return 0;

  const totalWeight = entries.reduce((sum, [, weight]) => sum + numeric(weight), 0);
  if (totalWeight <= 0) return 0;

  const weighted = entries.reduce((sum, [metric, weight]) => (
    sum + (numeric(metrics[metric]) * numeric(weight))
  ), 0);
  const score = weighted / totalWeight;
  return result.passed === false ? 0 : roundScore(score);
}

function addBudgetUsage(used, result = {}) {
  const cost = result.budget?.cost ?? result.cost;
  const tokens = result.budget?.tokens ?? result.tokens;
  used.cost += numeric(cost);
  used.tokens += numeric(tokens);
}

function average(values) {
  const numericValues = values.map((value) => numeric(value)).filter((value) => Number.isFinite(value));
  if (numericValues.length === 0) return 0;
  return roundScore(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length);
}

function rollbackDrillPassed(result = {}) {
  return result.rollbackDrill?.passed === true
    || result.rollbackDrillPassed === true
    || result.rollback?.drillPassed === true;
}

function budgetSummary(limits, used) {
  const exceededReasons = [];
  if (Number.isFinite(Number(limits.maxCandidateRuns)) && used.candidateRuns > Number(limits.maxCandidateRuns)) {
    exceededReasons.push('maxCandidateRuns_exceeded');
  }
  if (Number.isFinite(Number(limits.maxCases)) && used.casesEvaluated > Number(limits.maxCases)) {
    exceededReasons.push('maxCases_exceeded');
  }
  if (Number.isFinite(Number(limits.maxCost)) && used.cost > Number(limits.maxCost)) {
    exceededReasons.push('maxCost_exceeded');
  }
  if (Number.isFinite(Number(limits.maxTokens)) && used.tokens > Number(limits.maxTokens)) {
    exceededReasons.push('maxTokens_exceeded');
  }

  return {
    limits: cloneJson(limits, {}),
    used: {
      baselineRuns: used.baselineRuns,
      candidateRuns: used.candidateRuns,
      casesEvaluated: used.casesEvaluated,
      cost: roundScore(used.cost),
      tokens: roundScore(used.tokens),
    },
    exceeded: exceededReasons.length > 0,
    exceededReasons,
  };
}

function buildReportId({ suiteId, candidateIds, now }) {
  const timestamp = (typeof now === 'function' ? now() : now) ?? new Date();
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const safeTimestamp = date.toISOString().replace(/[:.]/g, '-');
  const candidatePart = candidateIds.length > 0 ? candidateIds.map((id) => reportIdPart(id, 'candidate')).join('-') : 'baseline';
  return `replay-cycle-${reportIdPart(suiteId, 'suite')}-${candidatePart}-${safeTimestamp}`;
}

function assertUniqueCandidateIds(normalizedCandidates) {
  const seen = new Set();
  for (const { id } of normalizedCandidates) {
    if (seen.has(id)) throw new Error(`duplicate candidate id: ${id}`);
    seen.add(id);
  }
}

export async function runReplayCycle({
  suite,
  candidates = [],
  baselineRunner,
  candidateRunner,
  budget = {},
  now = () => new Date(),
} = {}) {
  if (!suite || typeof suite !== 'object') throw new Error('suite is required');
  if (typeof baselineRunner !== 'function') throw new Error('baselineRunner is required');

  const suiteId = safeId(suite.id, 'suite');
  const replayCases = asArray(suite.cases);
  const normalizedCandidates = asArray(candidates)
    .map((candidate, index) => ({
      candidate,
      id: candidateId(candidate, index),
      index,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  assertUniqueCandidateIds(normalizedCandidates);
  if (normalizedCandidates.length > 0 && typeof candidateRunner !== 'function') {
    throw new Error('candidateRunner is required when candidates are provided');
  }

  const candidateIds = normalizedCandidates.map((candidate) => candidate.id);
  const quarantineBlocks = [];
  const blockedCaseIds = new Set();
  const blockedCandidateIds = new Set();
  const baselineScoresByDomain = new Map();
  const candidateScoresByDomain = new Map();
  const regressions = [];
  const usedBudget = {
    baselineRuns: 0,
    candidateRuns: 0,
    casesEvaluated: 0,
    cost: 0,
    tokens: 0,
  };
  let rollbackDrillRequired = false;

  const suiteBlocked = addQuarantineBlocks(quarantineBlocks, {
    scope: 'suite',
    id: suiteId,
    quarantine: suite.quarantine,
  });
  if (suiteBlocked) {
    return {
      reportId: buildReportId({ suiteId, candidateIds, now }),
      suiteId,
      candidateIds,
      domainScores: {},
      aggregateScore: 0,
      regressions: [],
      quarantineBlocks,
      rollbackDrillRequired: false,
      budget: budgetSummary(budget, usedBudget),
      promotionEvidenceOnly: true,
      canPromote: false,
      authority: 'evidence_only',
    };
  }

  for (const replayCase of replayCases) {
    const caseId = safeId(replayCase?.id, 'case');
    const blocked = addQuarantineBlocks(quarantineBlocks, {
      scope: 'case',
      id: caseId,
      quarantine: replayCase?.quarantine,
    });
    if (blocked) blockedCaseIds.add(caseId);
  }

  for (const { candidate, id } of normalizedCandidates) {
    const blocked = addQuarantineBlocks(quarantineBlocks, {
      scope: 'candidate',
      id,
      quarantine: candidate?.quarantine,
    });
    if (blocked) blockedCandidateIds.add(id);
  }

  for (const replayCase of replayCases) {
    const caseId = safeId(replayCase?.id, 'case');
    if (blockedCaseIds.has(caseId)) continue;

    const domain = safeId(replayCase?.domain ?? suite.domains?.[0], 'default');
    const baseline = cloneJson(await baselineRunner({ suite, case: replayCase }), {});
    const baselineScore = scoreResult(baseline, replayCase, suite);
    if (!baselineScoresByDomain.has(domain)) baselineScoresByDomain.set(domain, []);
    baselineScoresByDomain.get(domain).push(baselineScore);
    usedBudget.baselineRuns += 1;
    usedBudget.casesEvaluated += 1;
    addBudgetUsage(usedBudget, baseline);

    for (const { candidate, id } of normalizedCandidates) {
      if (blockedCandidateIds.has(id)) continue;

      const result = cloneJson(await candidateRunner({
        suite,
        candidate,
        candidateId: id,
        case: replayCase,
        baseline,
      }), {});
      usedBudget.candidateRuns += 1;
      addBudgetUsage(usedBudget, result);

      const resultBlocked = addQuarantineBlocks(quarantineBlocks, {
        scope: 'candidate_result',
        id,
        quarantine: result.quarantine,
      });
      if (resultBlocked) continue;

      const score = scoreResult(result, replayCase, suite);
      if (!candidateScoresByDomain.has(domain)) candidateScoresByDomain.set(domain, new Map());
      const domainCandidates = candidateScoresByDomain.get(domain);
      if (!domainCandidates.has(id)) domainCandidates.set(id, []);
      domainCandidates.get(id).push(score);

      if (score < baselineScore || result.passed === false) {
        regressions.push({
          candidateId: id,
          caseId,
          domain,
          baselineScore,
          candidateScore: score,
          reasons: sanitizeRegressionReasons(
            result.reasons ?? result.failures ?? (result.passed === false ? 'candidate_failed' : 'score_regression'),
            { quarantineBlocks, candidateId: id, caseId },
          ),
        });
      }

      if (score > baselineScore && !rollbackDrillPassed(result)) {
        rollbackDrillRequired = true;
      }
      if (result.rollbackDrillRequired === true) {
        rollbackDrillRequired = true;
      }
    }
  }

  const domainScores = {};
  const domainDeltas = [];
  for (const domain of [...baselineScoresByDomain.keys()].sort((left, right) => left.localeCompare(right))) {
    const baselineScore = average(baselineScoresByDomain.get(domain));
    const candidateScores = candidateScoresByDomain.get(domain) ?? new Map();
    let bestCandidateId = null;
    let bestCandidateScore = 0;

    for (const [id, scores] of [...candidateScores.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const candidateScore = average(scores);
      if (bestCandidateId === null || candidateScore > bestCandidateScore) {
        bestCandidateId = id;
        bestCandidateScore = candidateScore;
      }
    }

    const delta = roundScore(bestCandidateScore - baselineScore);
    domainScores[domain] = {
      baselineScore,
      bestCandidateId,
      bestCandidateScore,
      delta,
      caseCount: baselineScoresByDomain.get(domain).length,
    };
    domainDeltas.push(delta);
  }

  return {
    reportId: buildReportId({ suiteId, candidateIds, now }),
    suiteId,
    candidateIds,
    domainScores,
    aggregateScore: average(domainDeltas),
    regressions,
    quarantineBlocks,
    rollbackDrillRequired,
    budget: budgetSummary(budget, usedBudget),
    promotionEvidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
  };
}
