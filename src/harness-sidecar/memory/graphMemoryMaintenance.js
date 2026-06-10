import { evaluateMemoryRecord } from './memoryEvals.js';
import { createGraphMemoryStore, validateGraphSnapshotId } from './graphMemoryStore.js';

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function memoryIdFor(record = {}) {
  return validateGraphSnapshotId(record.memoryId || record.id);
}

function upsertNode(nodes, node) {
  validateGraphSnapshotId(node.id);
  const existing = nodes.get(node.id) || {};
  nodes.set(node.id, {
    ...existing,
    ...node,
    provenance: [
      ...normalizeList(existing.provenance),
      ...normalizeList(node.provenance),
    ],
  });
}

function upsertEdge(edges, edge) {
  validateGraphSnapshotId(edge.from);
  validateGraphSnapshotId(edge.to);
  const key = `${edge.from}\0${edge.to}\0${edge.type}`;
  const existing = edges.get(key) || {};
  edges.set(key, {
    ...existing,
    ...edge,
    provenance: [
      ...normalizeList(existing.provenance),
      ...normalizeList(edge.provenance),
    ],
  });
}

function feedbackDelta(item = {}) {
  if (typeof item.delta === 'number') return item.delta;
  const weight = typeof item.weight === 'number' ? item.weight : 1;
  if (item.signal === 'positive' || item.signal === 'upvote' || item.signal === 'success') return weight;
  if (item.signal === 'negative' || item.signal === 'downvote' || item.signal === 'failure') return -weight;
  return 0;
}

function buildFeedbackScores(feedback = []) {
  const scores = new Map();
  for (const item of feedback) {
    const memoryId = validateGraphSnapshotId(item.memoryId);
    scores.set(memoryId, (scores.get(memoryId) || 0) + feedbackDelta(item));
  }
  return scores;
}

function scoreToPercent(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return 0;
  if (score >= 0 && score <= 1) return Math.round(score * 100);
  return Math.round(score);
}

function summarizeEvalSets(evalSets = []) {
  return evalSets.map((evalSet) => {
    const evalSetId = validateGraphSnapshotId(evalSet.evalSetId || evalSet.id);
    const results = normalizeList(evalSet.results);
    const totalScore = results.reduce((sum, result) => sum + scoreToPercent(result.score), 0);
    return {
      evalSetId,
      summary: evalSet.summary || '',
      totalResults: results.length,
      passedCount: results.filter((result) => result.passed === true).length,
      averageScore: results.length === 0 ? 0 : Math.round(totalScore / results.length),
    };
  });
}

function runEvalHooks({ evalHooks = [], records = [] }) {
  return normalizeList(evalHooks).map((hook) => {
    const evalSetId = validateGraphSnapshotId(hook.evalSetId || hook.id);
    return {
      evalSetId,
      summary: hook.summary || '',
      results: records.map((record) => ({
        memoryId: memoryIdFor(record),
        ...(typeof hook.evaluate === 'function' ? hook.evaluate(record) : {}),
      })),
    };
  });
}

function buildEvalScores(evalSets = []) {
  const totals = new Map();
  for (const evalSet of evalSets) {
    for (const result of normalizeList(evalSet.results)) {
      const memoryId = validateGraphSnapshotId(result.memoryId);
      const current = totals.get(memoryId) || { total: 0, count: 0 };
      totals.set(memoryId, {
        total: current.total + scoreToPercent(result.score),
        count: current.count + 1,
      });
    }
  }

  const scores = new Map();
  for (const [memoryId, item] of totals.entries()) {
    scores.set(memoryId, item.count === 0 ? 0 : Math.round(item.total / item.count));
  }
  return scores;
}

function buildTraceCounts(traceSummaries = []) {
  const counts = new Map();
  for (const trace of traceSummaries) {
    validateGraphSnapshotId(trace.traceId || trace.id);
    for (const memoryId of normalizeList(trace.memoryIds)) {
      const validated = validateGraphSnapshotId(memoryId);
      counts.set(validated, (counts.get(validated) || 0) + 1);
    }
  }
  return counts;
}

function daysBetween(now, then) {
  const nowMs = new Date(now).getTime();
  const thenMs = new Date(then).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) return 0;
  return Math.max(0, Math.floor((nowMs - thenMs) / 86400000));
}

function buildDecayScores(records = [], { now, halfLifeDays = 60, staleAfterDays = 120 } = {}) {
  const scores = new Map();
  const referenceTime = now || new Date().toISOString();
  const halfLife = Math.max(1, Number(halfLifeDays) || 60);
  const staleAfter = Math.max(1, Number(staleAfterDays) || 120);

  for (const record of records) {
    const memoryId = memoryIdFor(record);
    const lastUsed = record.lastUsedAt || record.updatedAt || record.createdAt || referenceTime;
    const ageDays = daysBetween(referenceTime, lastUsed);
    const decayScore = Math.max(0, Math.round(100 * (0.5 ** (ageDays / halfLife))));
    scores.set(memoryId, {
      ageDays,
      decayScore,
      decayedStale: ageDays >= staleAfter,
    });
  }
  return scores;
}

function staleReasons(record = {}) {
  const reasons = [];
  if (record.stale) reasons.push('stale_flag');
  if (record.supersededBy || normalizeList(record.supersedes).length > 0) reasons.push('superseded');
  return reasons;
}

function buildStaleReviewItems(records = []) {
  return records
    .filter((record) => record.stale || record.supersededBy)
    .map((record) => {
      const memoryId = memoryIdFor(record);
      const supersededBy = record.supersededBy ? validateGraphSnapshotId(record.supersededBy) : null;
      return {
        queueId: `stale_${memoryId}`,
        memoryId,
        type: record.type,
        summary: record.summary || '',
        status: 'stale',
        priority: 1,
        reasons: staleReasons(record),
        supersededBy,
        evidence: normalizeList(record.evidence),
        provenance: normalizeList(record.provenance),
      };
    })
    .sort((left, right) => left.memoryId.localeCompare(right.memoryId));
}

function isContradictory(left, right) {
  return left.subject
    && left.subject === right.subject
    && left.predicate
    && left.predicate === right.predicate
    && left.object !== right.object;
}

function conflictKey(ids) {
  return ids.slice().sort().join('\0');
}

function buildConflictReviewItems(records = []) {
  const byId = new Map(records.map((record) => [memoryIdFor(record), record]));
  const conflicts = new Map();

  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const left = records[leftIndex];
      const right = records[rightIndex];
      if (!isContradictory(left, right)) continue;
      const ids = [memoryIdFor(left), memoryIdFor(right)];
      conflicts.set(conflictKey(ids), {
        left,
        right,
        conflictingMemoryIds: ids,
      });
    }
  }

  for (const record of records) {
    const leftId = memoryIdFor(record);
    for (const rightId of normalizeList(record.contradictions)) {
      const validatedRightId = validateGraphSnapshotId(rightId);
      if (!byId.has(validatedRightId)) continue;
      conflicts.set(conflictKey([leftId, validatedRightId]), {
        left: record,
        right: byId.get(validatedRightId),
        conflictingMemoryIds: [leftId, validatedRightId],
      });
    }
  }

  return [...conflicts.values()]
    .map(({ left, right, conflictingMemoryIds }) => ({
      queueId: `conflict_${conflictingMemoryIds.slice().sort().join('_')}`,
      type: 'memory_conflict',
      status: 'conflict',
      priority: 0,
      subject: left.subject || right.subject,
      predicate: left.predicate || right.predicate,
      summary: `Conflicting memories for ${left.subject || right.subject} ${left.predicate || right.predicate}`,
      conflictingMemoryIds,
      evidence: [...normalizeList(left.evidence), ...normalizeList(right.evidence)],
      provenance: [...normalizeList(left.provenance), ...normalizeList(right.provenance)],
    }))
    .sort((left, right) => left.queueId.localeCompare(right.queueId));
}

function consolidationKey(record = {}) {
  return [
    record.type,
    record.subject,
    record.predicate || record.relation,
    record.object,
  ].map((part) => String(part || '')).join('\0');
}

function buildConsolidationItems(records = []) {
  const groups = new Map();
  for (const record of records) {
    if (!record.subject || !(record.predicate || record.relation) || !record.object) continue;
    const key = consolidationKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const ordered = group.slice().sort((left, right) => memoryIdFor(left).localeCompare(memoryIdFor(right)));
      const first = ordered[0];
      const memoryIds = ordered.map(memoryIdFor);
      return {
        ...withoutUndefined({
          queueId: `consolidate_${memoryIds.join('_')}`,
          type: 'memory_consolidation',
          status: 'needs_review',
          memoryIds,
          subject: first.subject,
          predicate: first.predicate || first.relation,
          object: first.object,
          evidence: [...new Set(ordered.flatMap((record) => normalizeList(record.evidence)))].sort(),
        }),
      };
    })
    .sort((left, right) => left.queueId.localeCompare(right.queueId));
}

function buildRankings({ records, feedbackScores, evalScores, traceCounts, decayScores }) {
  const rankings = {};
  for (const record of records) {
    const memoryId = memoryIdFor(record);
    const qualityScore = evaluateMemoryRecord(record).score;
    const feedbackScore = feedbackScores.get(memoryId) || 0;
    const evalScore = evalScores.get(memoryId) || 0;
    const traceCount = traceCounts.get(memoryId) || 0;
    const decay = decayScores.get(memoryId) || { decayScore: 100, ageDays: 0, decayedStale: false };
    const stalePenalty = record.stale || record.supersededBy || decay.decayedStale ? 40 : 0;
    const score = Math.max(0, qualityScore + (feedbackScore * 5) + evalScore + traceCount + decay.decayScore - stalePenalty);

    rankings[memoryId] = {
      score,
      qualityScore,
      feedbackScore,
      evalScore,
      traceCount,
      decayScore: decay.decayScore,
      ageDays: decay.ageDays,
    };
  }
  return rankings;
}

function estimateContextTokens(record = {}) {
  const text = [
    record.type,
    record.summary,
    record.subject,
    record.predicate,
    record.object,
    ...normalizeList(record.tags),
    ...normalizeList(record.taskKeywords),
    ...normalizeList(record.evidence),
  ].join(' ');
  return Math.max(1, Math.ceil(text.length / 4));
}

function rankingReasons({ record, ranking }) {
  const reasons = ['rank:graph_memory'];
  if (record.reviewStatus) reasons.push(`review:${record.reviewStatus}`);
  if (record.validatorBacked === true) reasons.push('validator_backed');
  if (ranking.feedbackScore > 0) reasons.push('feedback:positive');
  if (ranking.feedbackScore < 0) reasons.push('feedback:negative');
  if (ranking.evalScore > 0) reasons.push(`eval:${ranking.evalScore}`);
  if (ranking.traceCount > 0) reasons.push(`trace_observed:${ranking.traceCount}`);
  for (const reason of staleReasons({ ...record, supersedes: [] })) {
    reasons.push(reason);
  }
  return reasons;
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function buildRankedContextItems({ records, rankings }) {
  return records
    .map((record) => {
      const memoryId = memoryIdFor(record);
      const ranking = rankings[memoryId] || {
        score: 0,
        qualityScore: 0,
        feedbackScore: 0,
        evalScore: 0,
        traceCount: 0,
      };
      return withoutUndefined({
        id: memoryId,
        memoryId,
        source: 'graph_memory',
        sourceLabel: `graph-memory:${memoryId}`,
        type: record.type,
        summary: record.summary || '',
        subject: record.subject,
        predicate: record.predicate,
        object: record.object,
        tags: normalizeList(record.tags),
        taskKeywords: normalizeList(record.taskKeywords),
        evidence: normalizeList(record.evidence),
        provenance: normalizeList(record.provenance),
        reviewStatus: record.reviewStatus,
        validatorBacked: record.validatorBacked === true,
        stale: Boolean(record.stale || record.supersededBy || ranking.decayScore < 20),
        supersededBy: record.supersededBy ? validateGraphSnapshotId(record.supersededBy) : null,
        ranking,
        score: ranking.score,
        reasons: rankingReasons({ record, ranking }),
        tokensEstimated: estimateContextTokens(record),
      });
    })
    .sort((left, right) => (
      right.ranking.score - left.ranking.score
      || left.memoryId.localeCompare(right.memoryId)
    ));
}

function addMemoryNodesAndEdges({ records, source, nodes, edges }) {
  for (const record of records) {
    const memoryId = memoryIdFor(record);
    upsertNode(nodes, {
      id: memoryId,
      kind: 'memory',
      source,
      type: record.type,
      summary: record.summary || '',
      tags: normalizeList(record.tags),
      taskKeywords: normalizeList(record.taskKeywords),
      evidence: normalizeList(record.evidence),
      provenance: normalizeList(record.provenance),
      reviewStatus: record.reviewStatus,
      validatorBacked: record.validatorBacked === true,
      stale: Boolean(record.stale || record.supersededBy),
    });

    for (const supersededId of normalizeList(record.supersedes)) {
      upsertEdge(edges, {
        from: memoryId,
        to: validateGraphSnapshotId(supersededId),
        type: 'supersedes',
        provenance: normalizeList(record.provenance),
      });
    }

    if (record.supersededBy) {
      upsertEdge(edges, {
        from: validateGraphSnapshotId(record.supersededBy),
        to: memoryId,
        type: 'supersedes',
        provenance: normalizeList(record.provenance),
      });
    }
  }
}

function addTraceNodesAndEdges({ traceSummaries, nodes, edges }) {
  for (const trace of traceSummaries) {
    const traceId = validateGraphSnapshotId(trace.traceId || trace.id);
    upsertNode(nodes, {
      id: traceId,
      kind: 'trace',
      taskId: trace.taskId || '',
      summary: trace.summary || '',
      outcome: trace.outcome || 'unknown',
    });

    for (const memoryId of normalizeList(trace.memoryIds)) {
      upsertEdge(edges, {
        from: traceId,
        to: validateGraphSnapshotId(memoryId),
        type: 'observed_memory',
      });
    }
  }
}

export async function maintainGraphMemorySnapshot({
  workspaceRoot,
  promotedMemories = [],
  candidates = [],
  traceSummaries = [],
  feedback = [],
  evalSets = [],
  evalHooks = [],
  now,
  decay = {},
  globalMemory,
  memoryGuidedGraph,
  store,
} = {}) {
  const graphStore = store || createGraphMemoryStore({ workspaceRoot });
  const promoted = normalizeList(promotedMemories);
  const candidateRecords = normalizeList(candidates);
  const records = [...promoted, ...candidateRecords];
  const resolvedEvalSets = [
    ...normalizeList(evalSets),
    ...runEvalHooks({ evalHooks, records }),
  ];
  const nodes = new Map();
  const edges = new Map();
  const feedbackScores = buildFeedbackScores(normalizeList(feedback));
  const evalScores = buildEvalScores(resolvedEvalSets);
  const traceCounts = buildTraceCounts(normalizeList(traceSummaries));
  const decayScores = buildDecayScores(records, { now, ...decay });

  addMemoryNodesAndEdges({ records: promoted, source: 'promoted_memory', nodes, edges });
  addMemoryNodesAndEdges({ records: candidateRecords, source: 'candidate_memory', nodes, edges });
  addTraceNodesAndEdges({ traceSummaries: normalizeList(traceSummaries), nodes, edges });

  const rankings = buildRankings({ records, feedbackScores, evalScores, traceCounts, decayScores });
  const snapshot = await graphStore.save({
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => (
      left.from.localeCompare(right.from)
      || left.to.localeCompare(right.to)
      || left.type.localeCompare(right.type)
    )),
    rankings,
    rankedContextItems: buildRankedContextItems({ records, rankings }),
    staleReviewItems: buildStaleReviewItems(records),
    conflictReviewItems: buildConflictReviewItems(records),
    consolidationItems: buildConsolidationItems(records),
    evalSummaries: summarizeEvalSets(resolvedEvalSets),
    ...(globalMemory ? { globalMemory } : {}),
    ...(memoryGuidedGraph ? { memoryGuidedGraph } : {}),
  });

  return {
    snapshot,
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
  };
}
