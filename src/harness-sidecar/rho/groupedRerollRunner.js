import {
  redactQuarantinedTextFields,
  runRhoReplayBatch,
  sanitizeEvidenceOnlyValue,
} from './replayBatchRunner.js';
import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function normalizeNow(now) {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function safeTimestamp(date) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function caseId(item = {}, fallback = '') {
  return stableString(item.caseId ?? item.taskId ?? item.id ?? fallback);
}

function normalizeCandidateFamilies(candidateFamilies) {
  return asArray(candidateFamilies)
    .filter(Boolean)
    .map((entry, index) => ({
      ...entry,
      candidateId: stableString(entry.candidateId ?? entry.id ?? entry.name ?? `candidate_${index + 1}`),
    }));
}

function coresetItems(coreset) {
  if (Array.isArray(coreset)) return coreset;
  return asArray(coreset?.items ?? coreset?.cases ?? coreset?.traces);
}

function coresetWithItems(coreset, items) {
  if (Array.isArray(coreset)) return items;
  return {
    ...(coreset ?? {}),
    items,
    selectedCount: items.length,
  };
}

function replayInputsFromSchedule(schedule = {}, key) {
  const inputs = schedule[key] ?? {};
  return {
    groupSize: Math.max(1, Math.floor(Number(inputs.groupSize ?? schedule.cadence?.groupSize ?? 1) || 1)),
    coreset: inputs.coreset ?? { items: [] },
  };
}

function itemIsQuarantined(item = {}) {
  return item.quarantined === true ||
    item.promotionEvidenceEligible === false ||
    Boolean(item.quarantine) ||
    (item.external === true && item.verified === false);
}

function splitReplayInputs({ promotionInputs, quarantineInputs }) {
  const promotionItems = coresetItems(promotionInputs.coreset);
  const scheduledQuarantineItems = coresetItems(quarantineInputs.coreset);
  const safePromotionItems = promotionItems.filter((item) => !itemIsQuarantined(item));
  const staleQuarantineItems = promotionItems
    .filter(itemIsQuarantined)
    .map((item) => ({
      ...item,
      quarantined: true,
      promotionEvidenceEligible: false,
      quarantineReason: stableString(item.quarantineReason ?? item.quarantine?.reason ?? 'quarantined_replay_input'),
    }));
  const quarantineById = new Map();
  for (const item of [...scheduledQuarantineItems, ...staleQuarantineItems]) {
    quarantineById.set(caseId(item, item.id), {
      ...item,
      quarantined: true,
      promotionEvidenceEligible: false,
    });
  }

  return {
    promotionInputs: {
      ...promotionInputs,
      coreset: coresetWithItems(promotionInputs.coreset, safePromotionItems),
    },
    quarantineInputs: {
      ...quarantineInputs,
      coreset: coresetWithItems(quarantineInputs.coreset, [...quarantineById.values()]),
    },
  };
}

function caseDomain(item = {}) {
  return stableString(item.domain ?? item.kind ?? 'unknown') || 'unknown';
}

function collectDomainsFromCases(cases = []) {
  return [...new Set(cases.map((entry) => caseDomain(entry.item)).filter(Boolean))].sort();
}

function summarizeDomainScores(report = {}) {
  const scores = {};
  for (const replayCase of report.cases ?? []) {
    const domain = caseDomain(replayCase.item);
    const current = scores[domain] ?? {
      domain,
      caseCount: 0,
      rerollCount: 0,
      validationPassedCount: 0,
      validationTotal: 0,
      preferredCandidateCount: 0,
      authority: 'evidence_only',
      promotionAllowed: false,
    };
    current.caseCount += 1;
    for (const candidate of replayCase.candidateFamily ?? []) {
      current.rerollCount += Number(candidate.rerollCount ?? candidate.rollouts?.length ?? 0);
      current.validationPassedCount += Number(candidate.validation?.passedCount ?? 0);
      current.validationTotal += Number(candidate.validation?.total ?? 0);
    }
    if ((replayCase.preferences ?? []).some((entry) => entry.preferred === 'candidate')) {
      current.preferredCandidateCount += 1;
    }
    scores[domain] = current;
  }

  return Object.fromEntries(
    Object.entries(scores)
      .map(([domain, entry]) => [
        domain,
        {
          ...entry,
          validationPassRate: entry.validationTotal > 0
            ? Number((entry.validationPassedCount / entry.validationTotal).toFixed(12))
            : 0,
        },
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function collectAggregateEvidence(report = {}) {
  const validationTotal = (report.familySummary?.rankings ?? [])
    .reduce((sum, entry) => sum + Number(entry.aggregate?.validationTotal ?? 0), 0);
  const validationPassedCount = (report.familySummary?.rankings ?? [])
    .reduce((sum, entry) => sum + Number(entry.aggregate?.validationPassedCount ?? 0), 0);
  const meanConsistencyScore = (report.familySummary?.rankings ?? [])
    .reduce((sum, entry) => sum + Number(entry.aggregate?.meanConsistencyScore ?? 0), 0) /
      Math.max(1, (report.familySummary?.rankings ?? []).length);

  return {
    selfValidation: {
      passedCount: validationPassedCount,
      total: validationTotal,
      passRate: validationTotal > 0 ? Number((validationPassedCount / validationTotal).toFixed(12)) : 0,
    },
    selfConsistency: {
      meanScore: Number(meanConsistencyScore.toFixed(12)),
    },
    selfPreference: {
      preferredCandidateId: report.familySummary?.preferredCandidateId ?? null,
      rankings: asArray(report.familySummary?.rankings).map((entry) => ({
        candidateId: entry.candidateId,
        caseWinRate: entry.aggregate?.caseWinRate ?? 0,
        scoreDelta: entry.scoreDelta,
        blockingEvidence: entry.blockingEvidence,
        authority: 'evidence_only',
        promotionAllowed: false,
      })),
    },
    authority: 'evidence_only',
    promotionAllowed: false,
  };
}

function hardCasesFromReport(report = {}, { quarantined = false } = {}) {
  const hardCases = [];
  for (const replayCase of report.cases ?? []) {
    const item = replayCase.item ?? {};
    for (const preference of replayCase.preferences ?? []) {
      const failureModes = [...new Set([
        ...asArray(preference.blockingEvidence),
        ...(quarantined ? ['quarantine_replay_failed'] : []),
      ])].filter(Boolean);
      if (failureModes.length === 0) continue;
      hardCases.push({
        id: `${caseId(item, replayCase.caseId)}:${preference.candidateId}`,
        caseId: caseId(item, replayCase.caseId),
        taskId: stableString(item.taskId ?? item.id ?? replayCase.caseId),
        candidateId: preference.candidateId,
        domain: caseDomain(item),
        failureModes,
        reasons: failureModes,
        target: 'rho_grouped_reroll_policy',
        source: quarantined ? 'rho_quarantine_grouped_reroll' : 'rho_grouped_reroll',
        score: failureModes.length,
        diversityKey: stableString(item.diversityKey ?? failureModes[0] ?? replayCase.caseId),
        authority: 'evidence_only',
        promotionAllowed: false,
        canPromote: false,
      });
    }
  }
  return hardCases.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

function sanitizeQuarantineBlocks({ schedule = {}, quarantineReport = {} } = {}) {
  const explicitBlocks = asArray(schedule.quarantineBlocks);
  const blockIds = new Set(explicitBlocks.map((block) => stableString(block.caseId ?? block.id)));
  const casesById = new Map(
    asArray(quarantineReport.cases).map((entry) => [caseId(entry.item, entry.caseId), entry]),
  );
  const implicitBlocks = asArray(quarantineReport.cases)
    .filter((entry) => !blockIds.has(caseId(entry.item, entry.caseId)))
    .map((entry) => ({
      caseId: caseId(entry.item, entry.caseId),
      domain: caseDomain(entry.item),
      reason: stableString(entry.item?.quarantineReason ?? 'quarantined_replay_input'),
      promotionEvidenceEligible: false,
    }));
  const blocks = [...explicitBlocks, ...implicitBlocks];

  return blocks.map((block) => {
    const replayCase = casesById.get(stableString(block.caseId ?? block.id));
    const quarantinedPayload = quarantineModelVisiblePayload({
      block,
      item: replayCase?.item,
      baseline: replayCase?.baseline,
      candidateFamily: replayCase?.candidateFamily,
      preferences: replayCase?.preferences,
    });
    const safeBlock = redactQuarantinedTextFields(sanitizeEvidenceOnlyValue(block));
    return {
      ...safeBlock,
      promotionEvidenceEligible: false,
      authority: 'evidence_only',
      promotionAllowed: false,
      canPromote: false,
      quarantine: {
        quarantined: quarantinedPayload.quarantined,
        reasons: quarantinedPayload.reasons,
        redacted: quarantinedPayload.redacted,
        value: redactQuarantinedTextFields(sanitizeEvidenceOnlyValue(quarantinedPayload.value)),
      },
    };
  });
}

async function runBatch({
  inputs,
  baseline,
  candidateFamilies,
  caseRunner,
  judges,
  schedule,
  quarantined,
  promotionEvidenceEligible,
}) {
  return runRhoReplayBatch({
    coreset: inputs.coreset,
    groupSize: inputs.groupSize,
    baselineRunner: async (context) => caseRunner({
      ...context,
      schedule,
      baseline,
      variant: 'baseline',
      quarantined,
      promotionEvidenceEligible,
    }),
    candidateFamily: candidateFamilies.map((family) => ({
      ...family,
      runner: async (context) => caseRunner({
        ...context,
        schedule,
        baseline,
        candidateFamily: family,
        quarantined,
        promotionEvidenceEligible,
      }),
    })),
    judges,
    promotionEvidenceEligible,
  });
}

export async function runGroupedRhoRerolls({
  schedule,
  baseline,
  candidateFamilies,
  caseRunner,
  judges = {},
  now,
} = {}) {
  if (!schedule || typeof schedule !== 'object') throw new Error('schedule must be an object');
  if (typeof caseRunner !== 'function') throw new Error('caseRunner must be a function');
  const family = normalizeCandidateFamilies(candidateFamilies);
  if (family.length === 0) throw new Error('candidateFamilies must include at least one candidate');

  const generatedAt = normalizeNow(now ?? schedule.generatedAt);
  const replayInputs = splitReplayInputs({
    promotionInputs: replayInputsFromSchedule(schedule, 'replayInputs'),
    quarantineInputs: replayInputsFromSchedule(schedule, 'quarantineReplayInputs'),
  });
  const promotionReport = await runBatch({
    inputs: replayInputs.promotionInputs,
    baseline,
    candidateFamilies: family,
    caseRunner,
    judges,
    schedule,
    quarantined: false,
    promotionEvidenceEligible: true,
  });
  const quarantineReport = coresetItems(replayInputs.quarantineInputs.coreset).length > 0
    ? await runBatch({
      inputs: replayInputs.quarantineInputs,
      baseline,
      candidateFamilies: family,
      caseRunner,
      judges,
      schedule,
      quarantined: true,
      promotionEvidenceEligible: false,
    })
    : {
      groupSize: replayInputs.quarantineInputs.groupSize,
      caseCount: 0,
      cases: [],
      preferences: [],
      familySummary: {
        preferredCandidateId: null,
        rankings: [],
        promotionAllowed: false,
        promotionEvidenceEligible: false,
        authority: 'evidence_only',
      },
    };

  const coveredDomains = asArray(schedule.coverage?.domains).length > 0
    ? asArray(schedule.coverage.domains).map(stableString)
    : collectDomainsFromCases(promotionReport.cases);
  const missingDomains = asArray(schedule.coverage?.missingDomains).map(stableString);
  const futureHardCases = [
    ...hardCasesFromReport(promotionReport),
    ...hardCasesFromReport(quarantineReport, { quarantined: true }),
  ];

  return {
    reportId: `grouped_rho_rerolls_${safeTimestamp(generatedAt)}_${stableString(schedule.scheduleId ?? 'manual')}`,
    scheduleId: stableString(schedule.scheduleId ?? ''),
    generatedAt: generatedAt.toISOString(),
    baselineId: stableString(baseline?.candidateId ?? baseline?.id ?? 'baseline'),
    candidateIds: family.map((entry) => entry.candidateId),
    domainCoverage: {
      coveredDomains,
      missingDomains,
      coveredCount: coveredDomains.length,
      missingCount: missingDomains.length,
    },
    domainScores: summarizeDomainScores(promotionReport),
    aggregate: collectAggregateEvidence(promotionReport),
    promotionReport,
    quarantineReport,
    familySummary: promotionReport.familySummary,
    quarantineBlocks: sanitizeQuarantineBlocks({ schedule, quarantineReport }),
    futureHardCases,
    evidenceOnly: true,
    promotionAllowed: false,
    canPromote: false,
    authority: 'evidence_only',
  };
}
