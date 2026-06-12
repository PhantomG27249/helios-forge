function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableString(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function normalizeNow(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return new Date(0);
  return date;
}

function roundMetric(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1_000_000_000_000) / 1_000_000_000_000;
}

function roundMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

function roundPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100) / 100;
}

function candidateIdFor(replayReport = {}, promotedCandidate = {}) {
  return stableString(
    promotedCandidate.candidateId ??
      promotedCandidate.id ??
      replayReport.candidateId ??
      replayReport.candidateIds?.[0] ??
      replayReport.familySummary?.preferredCandidateId ??
      replayReport.candidates?.[0]?.candidateId ??
      replayReport.candidates?.[0]?.id,
    'unknown_candidate',
  );
}

function reportIdFor(replayReport = {}, index = 0) {
  return stableString(
    replayReport.reportId ?? replayReport.id ?? replayReport.replayReportId,
    `rho_report_${index + 1}`,
  );
}

function suiteIdFor(replayReport = {}) {
  return stableString(
    replayReport.suiteId ?? replayReport.suite?.suiteId ?? replayReport.suite?.id,
    'unknown_suite',
  );
}

function scoreFromDomain(value) {
  if (typeof value === 'number') return roundMetric(value);
  const baselineScore = Number(value?.baselineScore);
  const delta = Number(value?.delta);
  return roundMetric(
    value?.bestCandidateScore ??
      value?.candidateScore ??
      value?.score ??
      value?.aggregateScore ??
      value?.meanScore ??
      value?.current ??
      (Number.isFinite(baselineScore) && Number.isFinite(delta) ? baselineScore + delta : undefined),
  );
}

function normalizeDomainScores(domainScores = {}) {
  return Object.fromEntries(
    Object.entries(domainScores)
      .map(([domain, value]) => [stableString(domain, 'unknown'), scoreFromDomain(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeBudget(budget = {}) {
  const rawSpentUsd = Number(budget.spentUsd ?? budget.usedUsd ?? budget.costUsd ?? budget.used?.cost ?? budget.used?.usd ?? 0);
  const spentUsd = roundMoney(rawSpentUsd);
  const maxUsd = budget.maxUsd === undefined && budget.limitUsd === undefined
    ? (
      budget.limits?.maxCost === undefined &&
        budget.limits?.cost === undefined &&
        budget.limits?.usd === undefined
        ? null
        : roundMoney(budget.limits?.maxCost ?? budget.limits?.cost ?? budget.limits?.usd)
    )
    : roundMoney(budget.maxUsd ?? budget.limitUsd);
  const remainingUsd = budget.remainingUsd === undefined
    ? (maxUsd === null ? null : roundMoney(maxUsd - spentUsd))
    : roundMoney(budget.remainingUsd);
  const casesRun = Math.max(0, Math.floor(Number(
    budget.casesRun ??
      budget.caseCount ??
      budget.usedCases ??
      budget.used?.casesEvaluated ??
      budget.used?.cases ??
      0,
  ) || 0));
  const maxCases = budget.maxCases === undefined && budget.caseLimit === undefined
    ? (budget.limits?.maxCases === undefined && budget.limits?.casesEvaluated === undefined && budget.limits?.cases === undefined
      ? null
      : Math.max(0, Math.floor(Number(budget.limits?.maxCases ?? budget.limits?.casesEvaluated ?? budget.limits?.cases) || 0)))
    : Math.max(0, Math.floor(Number(budget.maxCases ?? budget.caseLimit) || 0));
  const tokensUsed = Math.max(0, Math.floor(Number(budget.tokensUsed ?? budget.usedTokens ?? budget.used?.tokens ?? 0) || 0));
  const maxTokens = budget.maxTokens === undefined && budget.tokenLimit === undefined
    ? (budget.limits?.maxTokens === undefined && budget.limits?.tokens === undefined
      ? null
      : Math.max(0, Math.floor(Number(budget.limits?.maxTokens ?? budget.limits?.tokens) || 0)))
    : Math.max(0, Math.floor(Number(budget.maxTokens ?? budget.tokenLimit) || 0));

  return {
    spentUsd,
    maxUsd,
    remainingUsd,
    percentUsdUsed: maxUsd && maxUsd > 0 ? roundPercent((rawSpentUsd / maxUsd) * 100) : null,
    casesRun,
    maxCases,
    percentCasesUsed: maxCases && maxCases > 0 ? roundPercent((casesRun / maxCases) * 100) : null,
    tokensUsed,
    maxTokens,
    percentTokensUsed: maxTokens && maxTokens > 0 ? roundPercent((tokensUsed / maxTokens) * 100) : null,
    blockedJobCount: Math.max(0, Math.floor(Number(budget.blockedJobCount ?? 0) || 0)),
  };
}

function previousFor(record = {}, history = []) {
  const newestFirst = [...history].reverse();
  return newestFirst.find((entry) => (
    entry.suiteId === record.suiteId &&
      entry.candidateId === record.candidateId
  )) ?? newestFirst.find((entry) => entry.suiteId === record.suiteId) ?? null;
}

function domainDrift(current = {}, previous = null) {
  if (!previous) return {};
  const domains = [...new Set([
    ...Object.keys(previous.domainScores ?? {}),
    ...Object.keys(current.domainScores ?? {}),
  ])].sort();
  return Object.fromEntries(domains.map((domain) => {
    const previousScore = roundMetric(previous.domainScores?.[domain]);
    const currentScore = roundMetric(current.domainScores?.[domain]);
    const delta = roundMetric(currentScore - previousScore);
    let classification = 'unchanged';
    if (delta > 0) classification = 'improvement';
    if (delta < 0) classification = 'regression';
    return [domain, {
      previous: previousScore,
      current: currentScore,
      delta,
      classification,
    }];
  }));
}

function hasAuthorityShapedFields(entry = {}) {
  return [
    'authority',
    'canPromote',
    'promotionAllowed',
    'apply',
    'promote',
    'approved',
    'verified',
  ].some((key) => Object.hasOwn(entry, key));
}

function normalizeDomainDriftEntry(entry = {}) {
  const previous = roundMetric(entry.previous);
  const current = roundMetric(entry.current);
  const delta = entry.delta === undefined ? roundMetric(current - previous) : roundMetric(entry.delta);
  const classification = ['improvement', 'mixed', 'new', 'regression', 'unchanged'].includes(entry.classification)
    ? entry.classification
    : (delta > 0 ? 'improvement' : delta < 0 ? 'regression' : 'unchanged');
  const normalized = {
    previous,
    current,
    delta,
    classification,
  };
  if (hasAuthorityShapedFields(entry)) {
    normalized.authority = 'evidence_only';
    normalized.canPromote = false;
  }
  return normalized;
}

function normalizeDomainDrift(domainDrift = {}) {
  return Object.fromEntries(
    Object.entries(domainDrift)
      .map(([domain, entry]) => [stableString(domain, 'unknown'), normalizeDomainDriftEntry(entry)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function classifyRecord({ aggregateDelta, regressions = [], drift = {} } = {}) {
  const domainClassifications = Object.values(drift).map((entry) => entry.classification);
  const hasRegression = regressions.length > 0 || aggregateDelta < 0 || domainClassifications.includes('regression');
  const hasImprovement = aggregateDelta > 0 || domainClassifications.includes('improvement');
  if (aggregateDelta === null) return 'new';
  if (hasRegression && hasImprovement) return 'mixed';
  if (hasRegression) return 'regression';
  if (hasImprovement) return 'improvement';
  return 'unchanged';
}

function normalizeRegression(regression = {}, suiteId) {
  const previous = Number(regression.previous);
  const current = Number(regression.current);
  return {
    suiteId: stableString(regression.suiteId, suiteId),
    caseId: stableString(regression.caseId ?? regression.id, 'unknown_case'),
    domain: stableString(regression.domain, 'unknown'),
    metric: stableString(regression.metric, 'aggregateScore'),
    previous: Number.isFinite(previous) ? roundMetric(previous) : null,
    current: Number.isFinite(current) ? roundMetric(current) : null,
    delta: Number.isFinite(previous) && Number.isFinite(current) ? roundMetric(current - previous) : null,
    authority: 'evidence_only',
    canPromote: false,
  };
}

function isOldSuite(replayReport = {}, suiteId = '') {
  return replayReport.oldSuite === true ||
    replayReport.legacySuite === true ||
    Number(replayReport.suiteAgeDays ?? 0) >= 30 ||
    suiteId.toLowerCase().includes('old') ||
    suiteId.toLowerCase().includes('legacy');
}

function followUpFor(promotedCandidate = {}) {
  const suites = asArray(promotedCandidate.followUpSuites ?? promotedCandidate.targetSuites)
    .map((entry) => stableString(entry))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const required = Boolean(promotedCandidate.candidateId ?? promotedCandidate.id) || suites.length > 0;
  return {
    required,
    candidateId: stableString(promotedCandidate.candidateId ?? promotedCandidate.id, null),
    promotedAt: promotedCandidate.promotedAt ?? null,
    suites,
    reason: required ? 'promoted_candidate_follow_up' : null,
    authority: 'evidence_only',
    canPromote: false,
  };
}

function normalizeHistory(history = []) {
  return asArray(history).map((entry, index) => ({
    schemaVersion: 1,
    recordedAt: stableString(entry.recordedAt, new Date(0).toISOString()),
    reportId: stableString(entry.reportId, `rho_report_${index + 1}`),
    suiteId: stableString(entry.suiteId, 'unknown_suite'),
    candidateId: stableString(entry.candidateId, 'unknown_candidate'),
    aggregateScore: roundMetric(entry.aggregateScore),
    aggregateDelta: entry.aggregateDelta === null ? null : roundMetric(entry.aggregateDelta),
    previousReportId: entry.previousReportId ?? null,
    classification: stableString(entry.classification, 'new'),
    domainScores: normalizeDomainScores(entry.domainScores),
    domainDrift: normalizeDomainDrift(entry.domainDrift),
    oldSuite: entry.oldSuite === true,
    oldSuiteRegressions: asArray(entry.oldSuiteRegressions).map((regression) => normalizeRegression(regression, entry.suiteId)),
    followUp: {
      required: entry.followUp?.required === true,
      candidateId: entry.followUp?.candidateId ?? null,
      promotedAt: entry.followUp?.promotedAt ?? null,
      suites: asArray(entry.followUp?.suites).map((suite) => stableString(suite)).filter(Boolean),
      reason: entry.followUp?.reason ?? null,
      authority: 'evidence_only',
      canPromote: false,
    },
    budget: normalizeBudget(entry.budget),
    authority: 'evidence_only',
    evidenceOnly: true,
    canPromote: false,
    promotionAllowed: false,
  }));
}

export function updateRhoImprovementHistory({
  history = [],
  replayReport = {},
  promotedCandidate = {},
  now,
} = {}) {
  const normalizedHistory = normalizeHistory(history);
  const recordedAt = normalizeNow(now).toISOString();
  const suiteId = suiteIdFor(replayReport);
  const candidateId = candidateIdFor(replayReport, promotedCandidate);
  const draft = {
    suiteId,
    candidateId,
    domainScores: normalizeDomainScores(replayReport.domainScores),
  };
  const previous = previousFor(draft, normalizedHistory);
  const aggregateScore = roundMetric(replayReport.aggregateScore ?? replayReport.score);
  const aggregateDelta = previous ? roundMetric(aggregateScore - previous.aggregateScore) : null;
  const drift = domainDrift({ domainScores: draft.domainScores }, previous);
  const regressions = asArray(replayReport.regressions).map((entry) => normalizeRegression(entry, suiteId));
  const oldSuite = isOldSuite(replayReport, suiteId);

  const record = {
    schemaVersion: 1,
    recordedAt,
    reportId: reportIdFor(replayReport, normalizedHistory.length),
    suiteId,
    candidateId,
    aggregateScore,
    aggregateDelta,
    previousReportId: previous?.reportId ?? null,
    classification: classifyRecord({ aggregateDelta, regressions, drift }),
    domainScores: draft.domainScores,
    domainDrift: drift,
    oldSuite,
    oldSuiteRegressions: oldSuite ? regressions : [],
    followUp: followUpFor(promotedCandidate),
    budget: normalizeBudget(replayReport.budget ?? replayReport.accounting),
    authority: 'evidence_only',
    evidenceOnly: true,
    canPromote: false,
    promotionAllowed: false,
  };

  return [...normalizedHistory, record];
}

function classificationCounts(records = []) {
  const counts = {
    improvement: 0,
    mixed: 0,
    new: 0,
    regression: 0,
    unchanged: 0,
  };
  for (const record of records) {
    if (Object.hasOwn(counts, record.classification)) counts[record.classification] += 1;
  }
  return counts;
}

function summarizeBudget(records = []) {
  return records.reduce((summary, record) => ({
    spentUsd: roundMoney(summary.spentUsd + Number(record.budget?.spentUsd || 0)),
    maxUsd: record.budget?.maxUsd ?? summary.maxUsd,
    remainingUsd: record.budget?.remainingUsd ?? summary.remainingUsd,
    casesRun: summary.casesRun + Number(record.budget?.casesRun || 0),
    maxCases: record.budget?.maxCases ?? summary.maxCases,
    tokensUsed: summary.tokensUsed + Number(record.budget?.tokensUsed || 0),
    maxTokens: record.budget?.maxTokens ?? summary.maxTokens,
    blockedJobCount: summary.blockedJobCount + Number(record.budget?.blockedJobCount || 0),
  }), {
    spentUsd: 0,
    maxUsd: null,
    remainingUsd: null,
    casesRun: 0,
    maxCases: null,
    tokensUsed: 0,
    maxTokens: null,
    blockedJobCount: 0,
  });
}

function dashboardRow(record = {}) {
  return {
    recordedAt: record.recordedAt,
    reportId: record.reportId,
    suiteId: record.suiteId,
    candidateId: record.candidateId,
    classification: record.classification,
    previousReportId: record.previousReportId,
    aggregateScore: record.aggregateScore,
    aggregateDelta: record.aggregateDelta,
    domainScores: record.domainScores,
    domainDrift: record.domainDrift,
    oldSuite: record.oldSuite,
    oldSuiteRegressionCount: record.oldSuiteRegressions.length,
    followUpRequired: record.followUp.required,
    followUpSuites: record.followUp.suites,
    budget: record.budget,
    authority: 'evidence_only',
    evidenceOnly: true,
    canPromote: false,
  };
}

export function summarizeRhoImprovementTrends(history = []) {
  const records = normalizeHistory(history);
  return {
    schemaVersion: 1,
    authority: 'evidence_only',
    evidenceOnly: true,
    canPromote: false,
    promotionAllowed: false,
    recordCount: records.length,
    classificationCounts: classificationCounts(records),
    budget: summarizeBudget(records),
    dashboardRows: records.map(dashboardRow),
  };
}
