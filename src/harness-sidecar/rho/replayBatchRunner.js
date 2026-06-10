import { scoreSelfConsistency } from './selfConsistency.js';
import { judgeSelfPreference } from './selfPreferenceJudge.js';
import { scoreSelfValidation } from './selfValidation.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
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

function summarizeValidation(rollouts) {
  const results = rollouts.map(scoreSelfValidation);
  const passedCount = results.filter((result) => result.passed).length;
  return {
    passed: rollouts.length > 0 && passedCount === rollouts.length,
    passedCount,
    total: rollouts.length,
    score: passedCount,
    results,
  };
}

async function runVariant({ item, itemIndex, groupSize, variant, runner, heldoutVariants, candidate }) {
  const rollouts = [];
  for (const heldoutVariant of heldoutVariants) {
    for (let rolloutIndex = 0; rolloutIndex < groupSize; rolloutIndex += 1) {
      rollouts.push(await runner({
        item,
        itemIndex,
        rolloutIndex,
        variant,
        heldoutVariant,
        candidate,
      }));
    }
  }

  return {
    variant,
    candidateId: candidate?.candidateId,
    heldoutVariants,
    rollouts,
    validation: summarizeValidation(rollouts),
    consistency: scoreSelfConsistency({ rollouts }),
  };
}

function blockingEvidence(summary) {
  const blockers = [];
  if (summary.validation?.passed === false) blockers.push('validation_failed');
  if (summary.consistency?.consistent === false) blockers.push('consistency_failed');
  return blockers;
}

function summarizeFamily(preferences) {
  const aggregates = new Map();
  for (const preference of preferences) {
    const current = aggregates.get(preference.candidateId) || {
      candidateId: preference.candidateId,
      preferredCount: 0,
      caseCount: 0,
      candidateScore: 0,
      scoreDelta: 0,
      blockingEvidence: new Set(),
    };
    current.caseCount += 1;
    if (preference.preferred === 'candidate') current.preferredCount += 1;
    current.candidateScore += Number(preference.candidateScore || 0);
    current.scoreDelta += Number(preference.scoreDelta || 0);
    for (const blocker of preference.blockingEvidence || []) current.blockingEvidence.add(blocker);
    aggregates.set(preference.candidateId, current);
  }
  const ranked = [...aggregates.values()]
    .map((entry) => ({
      ...entry,
      preferred: entry.preferredCount > 0 ? 'candidate' : 'baseline',
      candidateScore: Number(entry.candidateScore.toFixed(12)),
      scoreDelta: Number(entry.scoreDelta.toFixed(12)),
      blockingEvidence: [...entry.blockingEvidence].sort(),
    }))
    .sort((left, right) => (
      right.scoreDelta - left.scoreDelta
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
    })),
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
      });
      candidateSummary.candidateId = familyMember.candidateId;
      candidateSummaries.push(candidateSummary);

      const preference = {
        candidateId: familyMember.candidateId,
        ...judgeSelfPreference({ baseline, candidate: candidateSummary }),
        blockingEvidence: blockingEvidence(candidateSummary),
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
    familySummary: summarizeFamily(allPreferences),
  };
}
