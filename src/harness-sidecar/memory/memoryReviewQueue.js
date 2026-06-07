function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function priorityForStatus(status) {
  if (status === 'quarantined') return 0;
  return 1;
}

export function createMemoryReviewQueue(items = []) {
  return items
    .filter(({ decision }) => decision?.status === 'needs_review' || decision?.status === 'quarantined')
    .map(({ record, decision }) => ({
      queueId: `review_${record.memoryId}`,
      memoryId: record.memoryId,
      type: record.type,
      summary: record.summary,
      status: decision.status,
      priority: priorityForStatus(decision.status),
      reasons: normalizeList(decision.reasons),
      evidence: normalizeList(record.evidence),
      provenance: normalizeList(record.provenance),
    }))
    .sort((left, right) => (
      left.priority - right.priority
      || left.memoryId.localeCompare(right.memoryId)
    ));
}
