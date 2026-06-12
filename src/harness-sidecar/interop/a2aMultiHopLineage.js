import { redactSecrets } from './agentCards.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function safeObject(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value, fallback = undefined) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizedTrust(hop = {}) {
  const trust = safeObject(hop.trust);
  const external = Boolean(hop.external ?? trust.external);
  return {
    external,
    verified: external ? false : Boolean(hop.verified ?? trust.verified),
    authority: 'evidence_only',
    canPromote: false,
  };
}

function normalizeHop({ lineage, hop }) {
  const prior = asArray(lineage);
  const safeHop = safeObject(hop);
  const previous = prior.at(-1);
  const messageId = text(safeHop.messageId);
  if (!messageId) throw new Error('A2A lineage hop messageId is required');
  if (prior.some((entry) => entry.messageId === messageId)) {
    throw new Error(`A2A lineage cycle detected for messageId: ${messageId}`);
  }
  const parentMessageId = text(safeHop.parentMessageId, previous?.messageId);
  if (parentMessageId === messageId) {
    throw new Error(`A2A lineage cycle detected for parentMessageId: ${messageId}`);
  }
  const rootMessageId = text(safeHop.rootMessageId, prior[0]?.rootMessageId || prior[0]?.messageId || messageId);
  if (prior.length > 0 && !prior.some((entry) => entry.messageId === parentMessageId)) {
    throw new Error(`A2A lineage parent is not in lineage: ${parentMessageId}`);
  }
  return redactSecrets({
    messageId,
    ...(parentMessageId ? { parentMessageId } : {}),
    rootMessageId,
    from: text(safeHop.from),
    to: text(safeHop.to),
    layer: text(safeHop.layer),
    taskId: text(safeHop.taskId),
    attemptId: text(safeHop.attemptId),
    trust: normalizedTrust(safeHop),
  });
}

function validateLineageGraph(lineage = []) {
  const ids = new Set();
  for (const hop of lineage) {
    if (ids.has(hop.messageId)) {
      throw new Error(`A2A lineage cycle detected for messageId: ${hop.messageId}`);
    }
    ids.add(hop.messageId);
  }

  const parentById = new Map();
  for (const hop of lineage) {
    if (!hop.parentMessageId) continue;
    if (hop.parentMessageId === hop.messageId) {
      throw new Error(`A2A lineage cycle detected for parentMessageId: ${hop.messageId}`);
    }
    if (!ids.has(hop.parentMessageId)) {
      throw new Error(`A2A lineage parent is not in lineage: ${hop.parentMessageId}`);
    }
    parentById.set(hop.messageId, hop.parentMessageId);
  }

  for (const hop of lineage) {
    const seen = new Set([hop.messageId]);
    let cursor = parentById.get(hop.messageId);
    while (cursor) {
      if (seen.has(cursor)) {
        throw new Error(`A2A lineage cycle detected for messageId: ${cursor}`);
      }
      seen.add(cursor);
      cursor = parentById.get(cursor);
    }
  }

  return lineage;
}

export function appendA2aLineageHop({ lineage = [], hop } = {}) {
  return validateLineageGraph([
    ...normalizeA2aLineage(lineage),
    normalizeHop({ lineage, hop }),
  ]);
}

export function compactA2aLineageForDashboard(lineage = []) {
  const hops = normalizeA2aLineage(lineage);
  return redactSecrets({
    hopCount: hops.length,
    messageIds: hops.map((hop) => hop.messageId),
    rootMessageId: hops[0]?.rootMessageId || null,
    lastMessageId: hops.at(-1)?.messageId || null,
    hops: hops.map((hop) => ({
      messageId: hop.messageId,
      parentMessageId: hop.parentMessageId,
      rootMessageId: hop.rootMessageId,
      from: hop.from,
      to: hop.to,
      layer: hop.layer,
      taskId: hop.taskId,
      attemptId: hop.attemptId,
      trust: hop.trust,
    })),
  });
}

export function normalizeA2aLineage(lineage = []) {
  const normalized = [];
  for (const hop of asArray(lineage)) {
    normalized.push(normalizeHop({ lineage: normalized, hop }));
  }
  return validateLineageGraph(normalized);
}
