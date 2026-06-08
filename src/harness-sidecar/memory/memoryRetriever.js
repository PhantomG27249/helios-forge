import { createPromotedMemoryStore } from './promotedMemoryStore.js';
import { createGraphMemoryStore } from './graphMemoryStore.js';

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function taskKeywordMatches(record, task) {
  const normalizedTask = normalizeText(task);
  return normalizeList(record.taskKeywords)
    .filter((keyword) => normalizedTask.includes(normalizeText(keyword)));
}

function estimateTokens(record) {
  const text = [
    record.type,
    record.summary,
    record.pattern,
    ...normalizeList(record.tags),
    ...normalizeList(record.taskKeywords),
    ...normalizeList(record.evidence),
  ].join(' ');
  return Math.max(1, Math.ceil(text.length / 4));
}

function buildReason(record, { type, tags = [], task } = {}) {
  const reasons = [];
  if (type && record.type === type) reasons.push(`type:${type}`);

  const recordTags = new Set(normalizeList(record.tags).map(normalizeText));
  for (const tag of normalizeList(tags)) {
    if (recordTags.has(normalizeText(tag))) reasons.push(`tag:${tag}`);
  }

  for (const keyword of taskKeywordMatches(record, task)) {
    reasons.push(`task:${keyword}`);
  }

  return unique(reasons);
}

export async function retrievePromotedMemory({
  workspaceRoot,
  task = '',
  type,
  tags = [],
  taskKeywords,
  limit = 8,
  store,
} = {}) {
  const promotedStore = store || createPromotedMemoryStore({ workspaceRoot });
  const requestedKeywords = taskKeywords || normalizeList(task);
  const records = await promotedStore.query({ type, tags, taskKeywords: requestedKeywords });

  return records
    .map((record) => {
      const reason = buildReason(record, { type, tags, task });
      return {
        memoryId: record.memoryId,
        type: record.type,
        summary: record.summary,
        source: 'promoted_memory',
        reason,
        provenance: normalizeList(record.provenance),
        evidence: normalizeList(record.evidence),
        tokenEstimate: estimateTokens(record),
        record,
      };
    })
    .filter((item) => item.reason.length > 0)
    .sort((left, right) => (
      right.reason.length - left.reason.length
      || left.memoryId.localeCompare(right.memoryId)
    ))
    .slice(0, limit);
}

function graphContextText(item = {}) {
  return [
    item.memoryId,
    item.type,
    item.summary,
    item.subject,
    item.predicate,
    item.object,
    ...normalizeList(item.tags),
    ...normalizeList(item.taskKeywords),
    ...normalizeList(item.evidence),
    ...normalizeList(item.reasons),
  ].join(' ');
}

function graphTaskMatches(item, task) {
  const taskTokens = normalizeText(task).split(/[^a-z0-9_]+/).filter(Boolean);
  if (taskTokens.length === 0) return true;
  const text = normalizeText(graphContextText(item));
  return taskTokens.some((token) => text.includes(token));
}

export async function retrieveGraphMemoryContext({
  workspaceRoot,
  task = '',
  limit = 8,
  includeStale = false,
  snapshot,
  store,
} = {}) {
  const graphStore = store || (snapshot ? null : createGraphMemoryStore({ workspaceRoot }));
  const loadedSnapshot = snapshot || await graphStore.load();
  return normalizeList(loadedSnapshot.rankedContextItems)
    .filter((item) => includeStale || item.stale !== true)
    .filter((item) => graphTaskMatches(item, task))
    .sort((left, right) => (
      (right.ranking?.score || 0) - (left.ranking?.score || 0)
      || left.memoryId.localeCompare(right.memoryId)
    ))
    .slice(0, limit);
}
