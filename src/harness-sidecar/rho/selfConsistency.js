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

export function scoreSelfConsistency({ rollouts = [] } = {}) {
  const normalized = asArray(rollouts)
    .map(rolloutSummary)
    .filter(Boolean);
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

  return {
    consistent: total > 0 && majorityCount > total / 2,
    score,
    majoritySummary: majority.summary,
    majorityCount,
    total,
    groups,
  };
}
