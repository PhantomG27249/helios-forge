function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeSummary(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function rolloutSummary(rollout = {}) {
  return normalizeSummary(
    rollout.compactHandoff?.summary ??
      rollout.summary ??
      rollout.result?.summary ??
      rollout.output?.summary
  );
}

function compareGroups(left, right) {
  if (right.count !== left.count) return right.count - left.count;
  return left.summary.localeCompare(right.summary);
}

function variantGroupId(rollout = {}) {
  return rollout.rhoReplay?.heldoutVariantId ?? rollout.heldoutVariantId ?? rollout.heldout_variant_id;
}

function scoreFlatSelfConsistency(rollouts) {
  const normalized = asArray(rollouts)
    .map((rollout) => rolloutSummary(rollout) || '__missing_summary__');
  const counts = new Map();
  for (const summary of normalized) {
    counts.set(summary, (counts.get(summary) ?? 0) + 1);
  }

  const groups = [...counts.entries()]
    .map(([summary, count]) => ({ summary, count }))
    .sort(compareGroups);
  const majority = groups[0] ?? { summary: '', count: 0 };
  const total = normalized.length;
  const majorityCount = majority.count;
  const score = total > 0 ? majorityCount / total : 0;
  const missingSummaryMajority = majority.summary === '__missing_summary__';
  const missingSummaryCount = normalized.filter((summary) => summary === '__missing_summary__').length;
  const distinctSummaryCount = groups.length;

  return {
    consistent: total > 0 && majorityCount > total / 2 && !missingSummaryMajority,
    score,
    majoritySummary: majority.summary,
    majorityCount,
    total,
    missingSummaryCount,
    distinctSummaryCount,
    advisoryOnly: true,
    groups,
  };
}

export function scoreSelfConsistency({ rollouts = [] } = {}) {
  const normalizedRollouts = asArray(rollouts);
  const grouped = new Map();
  for (const rollout of normalizedRollouts) {
    const groupId = variantGroupId(rollout);
    if (groupId !== undefined && groupId !== null) {
      const key = String(groupId);
      grouped.set(key, [...(grouped.get(key) ?? []), rollout]);
    }
  }

  if (grouped.size > 1) {
    const variantResults = [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([variantId, variantRollouts]) => ({
        variantId,
        ...scoreFlatSelfConsistency(variantRollouts),
      }));
    const total = normalizedRollouts.length;
    const score = variantResults.length > 0
      ? variantResults.reduce((sum, result) => sum + result.score, 0) / variantResults.length
      : 0;
    const consistent = variantResults.length > 0 && variantResults.every((result) => result.consistent);
    const majority = [...variantResults]
      .sort((left, right) => right.majorityCount - left.majorityCount || left.variantId.localeCompare(right.variantId))[0];
    return {
      consistent,
      score,
      majoritySummary: majority?.majoritySummary ?? '',
      majorityCount: variantResults.reduce((sum, result) => sum + result.majorityCount, 0),
      total,
      missingSummaryCount: variantResults.reduce((sum, result) => sum + result.missingSummaryCount, 0),
      distinctSummaryCount: variantResults.reduce((sum, result) => sum + result.distinctSummaryCount, 0),
      advisoryOnly: true,
      groupedBy: 'heldout_variant',
      variantResults,
      groups: variantResults.flatMap((result) => (
        result.groups.map((group) => ({ ...group, variantId: result.variantId }))
      )),
    };
  }

  return scoreFlatSelfConsistency(normalizedRollouts);
}
