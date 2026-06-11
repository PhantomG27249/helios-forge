const MAJOR_RHO_DOMAINS = ['code', 'research', 'memory', 'visual', 'tool', 'swarm', 'safety'];

function stableString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function normalizeNow(now) {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    return new Date(0);
  }
  return date;
}

function scheduleTimestamp(date) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function normalizeCadence(cadence) {
  if (typeof cadence === 'string') {
    return { interval: cadence, groupSize: 1 };
  }
  return {
    interval: stableString(cadence?.interval ?? cadence?.name ?? 'manual') || 'manual',
    groupSize: Math.max(1, Math.floor(Number(cadence?.groupSize ?? cadence?.rerollCount ?? 1) || 1)),
  };
}

function normalizeBudget(budget = {}) {
  return {
    maxCases: Math.max(0, Math.floor(Number(budget.maxCases ?? budget.caseLimit ?? 64) || 0)),
    maxCasesPerDomain: Math.max(1, Math.floor(Number(budget.maxCasesPerDomain ?? 8) || 1)),
    maxQuarantineCases: Math.max(0, Math.floor(Number(budget.maxQuarantineCases ?? budget.maxCases ?? 64) || 0)),
  };
}

function domainIndex(domain) {
  const index = MAJOR_RHO_DOMAINS.indexOf(domain);
  return index === -1 ? MAJOR_RHO_DOMAINS.length : index;
}

function normalizeDomain(value, fallback) {
  const domain = stableString(value ?? fallback).toLowerCase();
  return MAJOR_RHO_DOMAINS.includes(domain) ? domain : 'code';
}

function normalizeCase(input = {}, index, suite = null) {
  const suiteDomains = Array.isArray(suite?.domains) ? suite.domains : [];
  const domain = normalizeDomain(input.domain ?? input.kind ?? suiteDomains[0], 'code');
  const id = stableString(input.id ?? input.caseId ?? input.taskId ?? `${domain}_case_${index + 1}`);
  const quarantine = input.quarantine && typeof input.quarantine === 'object'
    ? input.quarantine
    : null;
  const quarantined = input.quarantined === true ||
    input.verified === false && input.external === true ||
    Boolean(quarantine);
  const quarantineReason = stableString(
    input.quarantineReason ??
      quarantine?.reason ??
      (quarantined ? 'quarantined' : ''),
  );
  const difficultyScore = Number(
    input.difficulty?.score ??
      input.difficulty ??
      input.score ??
      0,
  );
  return {
    ...input,
    id,
    caseId: stableString(input.caseId ?? id),
    taskId: stableString(input.taskId ?? id),
    domain,
    suiteId: suite?.id ? stableString(suite.id) : null,
    difficultyScore: Number.isFinite(difficultyScore) ? difficultyScore : 0,
    diversityKey: stableString(input.diversityKey ?? input.failureMode ?? input.kind ?? id),
    quarantined,
    quarantineReason: quarantineReason || null,
    promotionEvidenceEligible: !quarantined,
    authority: 'evidence_only',
    promotionAllowed: false,
  };
}

function collectSuiteCases(suites = []) {
  return (Array.isArray(suites) ? suites : [suites])
    .filter(Boolean)
    .flatMap((suite) => (
      (Array.isArray(suite.cases) ? suite.cases : [])
        .map((entry, index) => normalizeCase(entry, index, suite))
    ));
}

function collectCases(cases = [], suites = []) {
  const direct = (Array.isArray(cases) ? cases : [cases])
    .filter(Boolean)
    .map((entry, index) => normalizeCase(entry, index));
  return [...direct, ...collectSuiteCases(suites)];
}

function compareScheduledCases(left, right) {
  return domainIndex(left.domain) - domainIndex(right.domain) ||
    right.difficultyScore - left.difficultyScore ||
    left.diversityKey.localeCompare(right.diversityKey) ||
    left.id.localeCompare(right.id);
}

function selectByDomain(cases, budget) {
  const byDomain = new Map(MAJOR_RHO_DOMAINS.map((domain) => [domain, []]));
  for (const rhoCase of [...cases].sort(compareScheduledCases)) {
    const bucket = byDomain.get(rhoCase.domain) ?? [];
    if (bucket.length < budget.maxCasesPerDomain) {
      bucket.push(rhoCase);
      byDomain.set(rhoCase.domain, bucket);
    }
  }

  const selected = [];
  for (const domain of MAJOR_RHO_DOMAINS) {
    for (const rhoCase of byDomain.get(domain) ?? []) {
      if (selected.length < budget.maxCases) {
        selected.push(rhoCase);
      }
    }
  }
  return selected;
}

function coresetFromItems(items, totalCandidates) {
  return {
    items,
    selectedCount: items.length,
    totalCandidates,
  };
}

function quarantineBlocks(items) {
  return items.map((entry) => ({
    caseId: entry.id,
    domain: entry.domain,
    reason: entry.quarantineReason ?? 'quarantined',
    promotionEvidenceEligible: false,
  }));
}

export function planRhoReplaySchedule({
  cases = [],
  suites = [],
  cadence,
  budget,
  now,
} = {}) {
  const generatedAt = normalizeNow(now);
  const normalizedCadence = normalizeCadence(cadence);
  const normalizedBudget = normalizeBudget(budget);
  const allCases = collectCases(cases, suites);
  const promotionCandidates = allCases.filter((entry) => !entry.quarantined);
  const quarantineCandidates = allCases.filter((entry) => entry.quarantined);
  const selectedPromotion = selectByDomain(promotionCandidates, normalizedBudget);
  const selectedQuarantine = [...quarantineCandidates]
    .sort(compareScheduledCases)
    .slice(0, normalizedBudget.maxQuarantineCases)
    .map((entry) => ({
      ...entry,
      promotionEvidenceEligible: false,
    }));
  const coveredDomains = MAJOR_RHO_DOMAINS.filter((domain) => (
    selectedPromotion.some((entry) => entry.domain === domain)
  ));

  return {
    scheduleId: `rho_replay_${scheduleTimestamp(generatedAt)}_${normalizedCadence.interval}`,
    generatedAt: generatedAt.toISOString(),
    cadence: normalizedCadence,
    budget: normalizedBudget,
    coverage: {
      domains: coveredDomains,
      missingDomains: MAJOR_RHO_DOMAINS.filter((domain) => !coveredDomains.includes(domain)),
    },
    replayInputs: {
      groupSize: normalizedCadence.groupSize,
      coreset: coresetFromItems(selectedPromotion, promotionCandidates.length),
    },
    quarantineReplayInputs: {
      groupSize: normalizedCadence.groupSize,
      coreset: coresetFromItems(selectedQuarantine, quarantineCandidates.length),
    },
    quarantineBlocks: quarantineBlocks(selectedQuarantine),
    evidenceOnly: true,
    promotionAllowed: false,
    authority: 'evidence_only',
  };
}
