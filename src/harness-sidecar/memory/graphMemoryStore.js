import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const GRAPH_MEMORY_SCHEMA_VERSION = 1;

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function resolveWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function assertInsideWorkspace(workspaceRoot, targetPath) {
  const relative = path.relative(workspaceRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Graph memory snapshot path must stay inside workspaceRoot');
  }
}

export function getGraphMemorySnapshotPath(workspaceRoot) {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const filePath = path.resolve(resolvedRoot, '.harness', 'memory', 'graph-snapshot.json');
  assertInsideWorkspace(resolvedRoot, filePath);
  return filePath;
}

export function validateGraphSnapshotId(id) {
  if (typeof id !== 'string' || id.trim() !== id || id.length === 0) {
    throw new Error(`Invalid graph snapshot id: ${String(id)}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error(`Invalid graph snapshot id: ${id}`);
  }
  return id;
}

export function createEmptyGraphMemorySnapshot() {
  return {
    schemaVersion: GRAPH_MEMORY_SCHEMA_VERSION,
    nodes: [],
    edges: [],
    rankings: {},
    staleReviewItems: [],
    conflictReviewItems: [],
    evalSummaries: [],
  };
}

function validateNode(node = {}) {
  validateGraphSnapshotId(node.id);
}

function validateEdge(edge = {}) {
  validateGraphSnapshotId(edge.from);
  validateGraphSnapshotId(edge.to);
}

function validateRankingIds(rankings = {}) {
  for (const id of Object.keys(rankings || {})) {
    validateGraphSnapshotId(id);
  }
}

function validateReviewItem(item = {}) {
  if (item.queueId) validateGraphSnapshotId(item.queueId);
  if (item.memoryId) validateGraphSnapshotId(item.memoryId);
  if (item.supersededBy) validateGraphSnapshotId(item.supersededBy);
  for (const id of normalizeList(item.conflictingMemoryIds)) {
    validateGraphSnapshotId(id);
  }
}

function validateEvalSummary(summary = {}) {
  if (summary.evalSetId) validateGraphSnapshotId(summary.evalSetId);
}

export function normalizeGraphMemorySnapshot(snapshot = {}) {
  const normalized = {
    ...createEmptyGraphMemorySnapshot(),
    ...snapshot,
    schemaVersion: GRAPH_MEMORY_SCHEMA_VERSION,
    nodes: normalizeList(snapshot.nodes),
    edges: normalizeList(snapshot.edges),
    rankings: snapshot.rankings || {},
    staleReviewItems: normalizeList(snapshot.staleReviewItems),
    conflictReviewItems: normalizeList(snapshot.conflictReviewItems),
    evalSummaries: normalizeList(snapshot.evalSummaries),
  };

  normalized.nodes.forEach(validateNode);
  normalized.edges.forEach(validateEdge);
  validateRankingIds(normalized.rankings);
  normalized.staleReviewItems.forEach(validateReviewItem);
  normalized.conflictReviewItems.forEach(validateReviewItem);
  normalized.evalSummaries.forEach(validateEvalSummary);

  return normalized;
}

export function createGraphMemoryStore({ workspaceRoot } = {}) {
  const filePath = getGraphMemorySnapshotPath(workspaceRoot);

  async function load() {
    try {
      const raw = await readFile(filePath, 'utf8');
      return normalizeGraphMemorySnapshot(JSON.parse(raw));
    } catch (error) {
      if (error.code === 'ENOENT') return createEmptyGraphMemorySnapshot();
      throw error;
    }
  }

  async function save(snapshot) {
    const normalized = normalizeGraphMemorySnapshot(snapshot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
  }

  async function update(updater) {
    if (typeof updater !== 'function') throw new Error('updater is required');
    const current = await load();
    const next = await updater(current);
    return save(next);
  }

  return {
    filePath,
    load,
    save,
    update,
  };
}
