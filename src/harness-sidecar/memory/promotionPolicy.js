import { createMemoryReviewQueue } from './memoryReviewQueue.js';
import { createPromotedMemoryStore } from './promotedMemoryStore.js';
import { decideReflectionGate } from './reflectionGate.js';

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function promotedRecord(record, decision) {
  return {
    ...record,
    promotionStatus: 'promoted',
    promotionReasons: normalizeList(decision.reasons),
    evidence: normalizeList(record.evidence),
    tags: normalizeList(record.tags),
    taskKeywords: normalizeList(record.taskKeywords),
    provenance: normalizeList(record.provenance),
  };
}

export async function promoteMemoryCandidates({ workspaceRoot, candidates = [], store } = {}) {
  const promotedStore = store || createPromotedMemoryStore({ workspaceRoot });
  const decisions = candidates.map((record) => ({
    record,
    decision: decideReflectionGate(record),
  }));
  const promoted = [];
  const quarantined = [];
  const needsReview = [];

  for (const item of decisions) {
    if (item.decision.status === 'promotable') {
      const stored = await promotedStore.append(promotedRecord(item.record, item.decision));
      promoted.push(stored);
    } else if (item.decision.status === 'quarantined') {
      quarantined.push({
        ...item.record,
        reviewStatus: 'quarantined',
        quarantineReasons: normalizeList(item.decision.reasons),
      });
    } else if (item.decision.status === 'needs_review') {
      needsReview.push(item.record);
    }
  }

  return {
    promoted,
    quarantined,
    needsReview,
    reviewQueue: createMemoryReviewQueue(decisions),
    decisions,
  };
}
