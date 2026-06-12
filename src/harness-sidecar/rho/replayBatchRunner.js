import { scoreSelfConsistency } from './selfConsistency.js';
import { judgeSelfPreference } from './selfPreferenceJudge.js';
import { scoreSelfValidation } from './selfValidation.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKey(key) {
  return String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function isAuthorityBooleanKey(key) {
  const normalized = normalizeKey(key);
  return normalized === 'apply' ||
    normalized === 'approved' ||
    normalized === 'canpromote' ||
    normalized === 'promotionallowed' ||
    normalized === 'verified';
}

function sanitizeEvidenceOnlyValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidenceOnlyValue);
  if (!isPlainObject(value)) return value;

  const sanitized = {};
  for (const [key, child] of Object.entries(value)) {
    if (isAuthorityBooleanKey(key) && child === true) {
      sanitized[key] = false;
      continue;
    }
    if (normalizeKey(key) === 'authority' && typeof child === 'string' && child !== 'evidence_only') {
      sanitized[key] = 'evidence_only';
      continue;
    }
    sanitized[key] = sanitizeEvidenceOnlyValue(child);
  }
  return sanitized;
}

function collectCoresetItems(coreset) {
  if (Array.isArray(coreset)) return coreset;
  return asArray(coreset?.items ?? coreset?.traces ?? coreset?.cases);
}

function caseId(item, index) {
  return String(item?.caseId ?? item?.taskId ?? item?.id ?? `case_${index + 1}`);
}

function variantId(variant, index) {
  if (variant && typeof variant === 'object' && !Array.isArray(variant)) {
    return String(variant.variantId ?? variant.id ?? variant.name ?? `variant_${index + 1}`);
  }
  return String(variant ?? `variant_${index + 1}`);
}

function normalizeHeldoutVariant(variant, index) {
  if (variant && typeof variant === 'object' && !Array.isArray(variant)) {
    return {
      variantId: variantId(variant, index),
      ...variant,
    };
  }
  return { variantId: variantId(variant, index) };
}

function collectHeldoutVariants(item, fallbackVariants) {
  const variants = asArray(item?.heldoutVariants ?? item?.heldout_variants);
  const fallback = asArray(fallbackVariants);
  const selected = variants.length > 0 ? variants : fallback;
  const normalized = selected.length > 0 ? selected : [{ variantId: 'default' }];
  return normalized.map(normalizeHeldoutVariant);
}

function normalizeCandidateFamily({ candidateFamily, candidateRunner, candidate = {} } = {}) {
  const family = asArray(candidateFamily).filter(Boolean);
  if (family.length > 0) {
    return family.map((entry, index) => ({
      ...entry,
      candidateId: String(entry.candidateId ?? entry.id ?? entry.candidate?.candidateId ?? `candidate_${index + 1}`),
      candidate: entry.candidate ?? entry,
      runner: entry.runner ?? entry.candidateRunner ?? candidateRunner,
    }));
  }
  return [{
    candidateId: String(candidate.candidateId ?? 'candidate'),
    candidate,
    runner: candidateRunner,
  }];
}

function summarizeValidation(rollouts, selfValidationJudge = scoreSelfValidation) {
  const results = rollouts.map(selfValidationJudge);
  const passedCount = results.filter((result) => result.passed).length;
  const total = rollouts.length;
  return {
    passed: total > 0 && passedCount === total,
    passedCount,
    total,
    passRate: total > 0 ? Number((passedCount / total).toFixed(12)) : 0,
    score: passedCount,
    results,
  };
}

function summarizeMetrics(rollouts) {
  const totals = new Map();
  const counts = new Map();
  for (const rollout of rollouts) {
    for (const [key, value] of Object.entries(rollout?.metrics ?? {})) {
      const number = Number(value);
      if (Number.isFinite(number)) {
        totals.set(key, (totals.get(key) ?? 0) + number);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return Object.fromEntries(
    [...totals.entries()]
      .map(([key, total]) => [key, Number((total / counts.get(key)).toFixed(12))])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function runVariant({
  item,
  itemIndex,
  groupSize,
  variant,
  runner,
  heldoutVariants,
  candidate,
  judges = {},
}) {
  const rollouts = [];
  for (const heldoutVariant of heldoutVariants) {
    for (let rolloutIndex = 0; rolloutIndex < groupSize; rolloutIndex += 1) {
      const rollout = await runner({
        item,
        itemIndex,
        rolloutIndex,
        variant,
        heldoutVariant,
        candidate,
      });
      const evidenceOnlyRollout = sanitizeEvidenceOnlyValue(rollout ?? {});
      rollouts.push({
        ...evidenceOnlyRollout,
        rhoReplay: {
          ...(evidenceOnlyRollout.rhoReplay ?? {}),
          variant,
          rolloutIndex,
          heldoutVariantId: String(heldoutVariant.variantId ?? heldoutVariant.id ?? heldoutVariant),
          candidateId: candidate?.candidateId,
        },
      });
    }
  }

  return {
    variant,
    candidateId: candidate?.candidateId,
    heldoutVariants,
    heldoutVariantCount: heldoutVariants.length,
    rerollCount: rollouts.length,
    rollouts,
    validation: summarizeValidation(rollouts, judges.selfValidation ?? scoreSelfValidation),
    consistency: (judges.selfConsistency ?? scoreSelfConsistency)({ rollouts }),
    metrics: summarizeMetrics(rollouts),
  };
}

function blockingEvidence(summary) {
  const blockers = [];
  if (summary.validation?.passed === false) blockers.push('validation_failed');
  if (summary.consistency?.consistent === false) blockers.push('consistency_failed');
  return blockers;
}

function replayAggregate(summary = {}) {
  return {
    rerollCount: Number(summary.rerollCount ?? summary.rollouts?.length ?? 0),
    heldoutVariantCount: Number(summary.heldoutVariantCount ?? summary.heldoutVariants?.length ?? 0),
    validationPassedCount: Number(summary.validation?.passedCount ?? 0),
    validationTotal: Number(summary.validation?.total ?? 0),
    validationPassRate: Number(summary.validation?.passRate ?? 0),
    consistencyScore: Number(summary.consistency?.score ?? 0),
    consistencyMajorityCount: Number(summary.consistency?.majorityCount ?? 0),
    consistencyTotal: Number(summary.consistency?.total ?? 0),
    consistent: summary.consistency?.consistent === true,
  };
}

function aggregatePromotionEvidence(entry, blockingEvidence = []) {
  const evidence = [];
  if (blockingEvidence.length === 0) {
    evidence.push('aggregate_no_blockers');
  }
  if (blockingEvidence.length === 0 && entry.caseCount > 0 && entry.preferredCount > entry.caseCount / 2) {
    evidence.push('candidate_family_majority_preferred');
  }
  if (blockingEvidence.length === 0 && entry.scoreDelta > 0) {
    evidence.push('positive_self_preference_delta');
  }
  if (entry.rerollCount >= Math.max(2, entry.caseCount * 2)) {
    evidence.push('grouped_reroll_evidence');
  }
  if (entry.heldoutVariantIds.size > 1) {
    evidence.push('heldout_variant_coverage');
  }
  if (entry.validationTotal > 0 && entry.validationPassedCount === entry.validationTotal) {
    evidence.push('self_validation_all_passed');
  }
  if (entry.caseCount > 0 && entry.consistencyScoreTotal / entry.caseCount > 0.5) {
    evidence.push('self_consistency_signal');
  }
  return evidence.sort();
}

function summarizeFamily(preferences, { promotionEvidenceEligible = true } = {}) {
  const aggregates = new Map();
  for (const preference of preferences) {
    const current = aggregates.get(preference.candidateId) || {
      candidateId: preference.candidateId,
      preferredCount: 0,
      caseCount: 0,
      candidateScore: 0,
      scoreDelta: 0,
      blockingEvidence: new Set(),
      rerollCount: 0,
      heldoutVariantIds: new Set(),
      validationPassedCount: 0,
      validationTotal: 0,
      consistencyScoreTotal: 0,
      consistentCaseCount: 0,
    };
    const aggregate = preference.aggregate ?? {};
    current.caseCount += 1;
    if (preference.preferred === 'candidate') current.preferredCount += 1;
    current.candidateScore += Number(preference.candidateScore || 0);
    current.scoreDelta += Number(preference.scoreDelta || 0);
    for (const blocker of preference.blockingEvidence || []) current.blockingEvidence.add(blocker);
    current.rerollCount += Number(aggregate.rerollCount || 0);
    current.validationPassedCount += Number(aggregate.validationPassedCount || 0);
    current.validationTotal += Number(aggregate.validationTotal || 0);
    current.consistencyScoreTotal += Number(aggregate.consistencyScore || 0);
    if (aggregate.consistent === true) current.consistentCaseCount += 1;
    for (const variant of preference.heldoutVariants || []) {
      current.heldoutVariantIds.add(String(variant.variantId ?? variant.id ?? variant));
    }
    aggregates.set(preference.candidateId, current);
  }
  const ranked = [...aggregates.values()]
    .map((entry) => {
      const blockingEvidence = [...entry.blockingEvidence];
      if (entry.validationTotal > 0 && entry.validationPassedCount < entry.validationTotal) {
        blockingEvidence.push('aggregate_validation_failed');
      }
      if (entry.caseCount > 0 && entry.consistentCaseCount < entry.caseCount) {
        blockingEvidence.push('aggregate_consistency_failed');
      }
      const validationPassRate = entry.validationTotal > 0
        ? Number((entry.validationPassedCount / entry.validationTotal).toFixed(12))
        : 0;
      const meanConsistencyScore = entry.caseCount > 0
        ? Number((entry.consistencyScoreTotal / entry.caseCount).toFixed(12))
        : 0;
      const caseWinRate = entry.caseCount > 0
        ? Number((entry.preferredCount / entry.caseCount).toFixed(12))
        : 0;
      const hasBlockingEvidence = blockingEvidence.length > 0;
      return {
        ...entry,
        preferred: entry.preferredCount > 0 ? 'candidate' : 'baseline',
        candidateScore: Number(entry.candidateScore.toFixed(12)),
        scoreDelta: Number(entry.scoreDelta.toFixed(12)),
        blockingEvidence: [...new Set(blockingEvidence)].sort(),
        promotionEvidence: promotionEvidenceEligible
          ? aggregatePromotionEvidence(entry, [...new Set(blockingEvidence)])
          : [],
        promotionEvidenceEligible,
        promotionAllowed: false,
        authority: 'evidence_only',
        advisoryOnly: true,
        hasBlockingEvidence,
        aggregate: {
          rerollCount: entry.rerollCount,
          heldoutVariantCount: entry.heldoutVariantIds.size,
          validationPassedCount: entry.validationPassedCount,
          validationTotal: entry.validationTotal,
          validationPassRate,
          meanConsistencyScore,
          caseWinRate,
        },
      };
    })
    .sort((left, right) => (
      Number(left.hasBlockingEvidence) - Number(right.hasBlockingEvidence)
        || right.aggregate.caseWinRate - left.aggregate.caseWinRate
        || right.scoreDelta - left.scoreDelta
        || right.candidateScore - left.candidateScore
        || left.blockingEvidence.length - right.blockingEvidence.length
        || left.candidateId.localeCompare(right.candidateId)
    ));
  return {
    preferredCandidateId: ranked[0]?.candidateId ?? null,
    rankings: ranked.map((entry) => ({
      candidateId: entry.candidateId,
      preferred: entry.preferred,
      candidateScore: entry.candidateScore,
      scoreDelta: entry.scoreDelta,
      caseCount: entry.caseCount,
      preferredCount: entry.preferredCount,
      blockingEvidence: entry.blockingEvidence,
      promotionEvidence: entry.promotionEvidence,
      promotionEvidenceEligible: entry.promotionEvidenceEligible,
      promotionAllowed: entry.promotionAllowed,
      authority: entry.authority,
      advisoryOnly: entry.advisoryOnly,
      aggregate: entry.aggregate,
    })),
    promotionAllowed: false,
    promotionEvidenceEligible,
    authority: 'evidence_only',
  };
}

export async function runRhoReplayBatch({
  coreset,
  groupSize = 1,
  heldoutVariants,
  baselineRunner,
  candidateRunner,
  candidateFamily,
  candidate = {},
  judges = {},
  promotionEvidenceEligible = true,
} = {}) {
  if (typeof baselineRunner !== 'function') throw new Error('baselineRunner must be a function');
  const family = normalizeCandidateFamily({ candidateFamily, candidateRunner, candidate });
  for (const familyMember of family) {
    if (typeof familyMember.runner !== 'function') {
      throw new Error('candidateRunner must be a function');
    }
  }

  const safeGroupSize = Math.max(1, Math.floor(Number(groupSize) || 1));
  const items = collectCoresetItems(coreset);
  const cases = [];
  const allPreferences = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const caseHeldoutVariants = collectHeldoutVariants(item, heldoutVariants);
    const baseline = await runVariant({
      item,
      itemIndex,
      groupSize: safeGroupSize,
      variant: 'baseline',
      runner: baselineRunner,
      heldoutVariants: caseHeldoutVariants,
      judges,
    });
    const candidateSummaries = [];
    const preferences = [];

    for (const familyMember of family) {
      const candidateSummary = await runVariant({
        item,
        itemIndex,
        groupSize: safeGroupSize,
        variant: familyMember.candidateId,
        runner: familyMember.runner,
        heldoutVariants: caseHeldoutVariants,
        candidate: {
          ...familyMember.candidate,
          candidateId: familyMember.candidateId,
        },
        judges,
      });
      candidateSummary.candidateId = familyMember.candidateId;
      candidateSummaries.push(candidateSummary);

      const preferenceJudgment = sanitizeEvidenceOnlyValue(
        (judges.selfPreference ?? judgeSelfPreference)({ baseline, candidate: candidateSummary }),
      );
      const preference = {
        candidateId: familyMember.candidateId,
        ...preferenceJudgment,
        blockingEvidence: blockingEvidence(candidateSummary),
        aggregate: replayAggregate(candidateSummary),
        heldoutVariants: caseHeldoutVariants,
        promotionEvidenceEligible,
        promotionAllowed: false,
        authority: 'evidence_only',
      };
      preferences.push(preference);
      allPreferences.push({
        caseId: caseId(item, itemIndex),
        ...preference,
      });
    }

    cases.push({
      caseId: caseId(item, itemIndex),
      item,
      heldoutVariants: caseHeldoutVariants,
      baseline,
      candidate: candidateSummaries[0],
      candidateFamily: candidateSummaries,
      preferences,
    });
  }

  return {
    groupSize: safeGroupSize,
    caseCount: cases.length,
    cases,
    preferences: allPreferences,
    familySummary: summarizeFamily(allPreferences, { promotionEvidenceEligible }),
  };
}
