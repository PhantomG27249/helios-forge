import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

const SAFE_SNAPSHOT_ID = /^[A-Za-z0-9_-]+$/;
const DEFAULT_FS = {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
};

function assertWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInsideRoot(root, target) {
  if (!isInsideRoot(root, target)) {
    throw new Error(`operator dashboard path escapes workspace: ${target}`);
  }
  return target;
}

function assertSafeSnapshotId(snapshotId) {
  if (typeof snapshotId !== 'string' || !SAFE_SNAPSHOT_ID.test(snapshotId)) {
    throw new Error(`unsafe operator dashboard snapshot id: ${snapshotId || ''}`);
  }
  return snapshotId;
}

function timestampId(createdAt) {
  return `operator-${createdAt.replace(/[:.]/g, '-')}`;
}

function normalizeDate(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    throw new Error('operator dashboard snapshot timestamp is invalid');
  }
  return date.toISOString();
}

function normalizeLane(value) {
  if (Array.isArray(value)) return { items: value };
  if (isPlainObject(value)) return { ...value };
  return { status: 'unavailable' };
}

function snapshotFromInput({
  frontier,
  governance,
  memory,
  visual,
  trust,
  swarm,
  rho,
  router,
  createdAt,
  now,
} = {}) {
  const timestamp = normalizeDate(now || createdAt || (() => new Date()));
  return {
    schemaVersion: 1,
    snapshotId: timestampId(timestamp),
    createdAt: timestamp,
    evidenceOnly: true,
    canPromote: false,
    frontier: normalizeLane(frontier),
    governance: normalizeLane(governance),
    memory: normalizeLane(memory),
    visual: normalizeLane(visual),
    trust: normalizeLane(trust),
    swarm: normalizeLane(swarm),
    rho: normalizeLane(rho),
    router: normalizeLane(router),
  };
}

function normalizeSnapshot(snapshot = {}) {
  const base = snapshotFromInput(snapshot);
  const merged = {
    ...base,
    ...snapshot,
    snapshotId: snapshot.snapshotId || base.snapshotId,
    createdAt: snapshot.createdAt || base.createdAt,
    evidenceOnly: true,
    canPromote: false,
    frontier: normalizeLane(snapshot.frontier),
    governance: normalizeLane(snapshot.governance),
    memory: normalizeLane(snapshot.memory),
    visual: normalizeLane(snapshot.visual),
    trust: normalizeLane(snapshot.trust),
    swarm: normalizeLane(snapshot.swarm),
    rho: normalizeLane(snapshot.rho),
    router: normalizeLane(snapshot.router),
  };
  delete merged.apply;
  delete merged.promote;
  delete merged.approved;
  delete merged.promotionAllowed;
  return merged;
}

async function existingPathInfo(fsImpl, filePath) {
  try {
    return await fsImpl.lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertNoSymlinkAncestors({ fsImpl, root, target }) {
  if (typeof fsImpl.lstat !== 'function') return;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  assertInsideRoot(resolvedRoot, resolvedTarget);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative) return;
  const parts = relative.split(path.sep).filter(Boolean);
  let cursor = resolvedRoot;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const info = await existingPathInfo(fsImpl, cursor);
    if (!info) return;
    if (info.isSymbolicLink()) {
      throw new Error(`operator dashboard path uses symlink or junction: ${cursor}`);
    }
  }
}

async function assertRealParentInsideRoot({ fsImpl, root, target }) {
  if (typeof fsImpl.realpath !== 'function') return;
  const rootReal = await fsImpl.realpath(root);
  const parentReal = await fsImpl.realpath(path.dirname(target));
  assertInsideRoot(rootReal, parentReal);
}

async function prepareSafeTarget({ fsImpl, root, target }) {
  await assertNoSymlinkAncestors({ fsImpl, root, target });
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  await assertNoSymlinkAncestors({ fsImpl, root, target });
  await assertRealParentInsideRoot({ fsImpl, root, target });
}

function dashboardRoot(workspaceRoot) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  return assertInsideRoot(
    resolvedWorkspaceRoot,
    path.join(resolvedWorkspaceRoot, '.harness', 'dashboards', 'operator'),
  );
}

function filePathForSnapshot({ workspaceRoot, snapshotId }) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  const safeSnapshotId = assertSafeSnapshotId(snapshotId);
  return assertInsideRoot(
    resolvedWorkspaceRoot,
    path.join(dashboardRoot(resolvedWorkspaceRoot), `${safeSnapshotId}.json`),
  );
}

function jsonContent(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildOperatorDashboardSnapshot(input = {}) {
  const normalized = normalizeSnapshot(input);
  const quarantined = quarantineModelVisiblePayload(normalized);
  const snapshot = {
    ...quarantined.value,
    schemaVersion: 1,
    snapshotId: normalized.snapshotId,
    createdAt: normalized.createdAt,
    evidenceOnly: true,
    canPromote: false,
    quarantine: {
      quarantined: quarantined.quarantined,
      reasons: quarantined.reasons,
      redacted: quarantined.redacted,
    },
  };
  delete snapshot.apply;
  delete snapshot.promote;
  delete snapshot.approved;
  delete snapshot.promotionAllowed;
  return snapshot;
}

export function createOperatorDashboardStore({ workspaceRoot, fsImpl = DEFAULT_FS } = {}) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  const root = dashboardRoot(resolvedWorkspaceRoot);

  async function saveSnapshot(snapshot = {}) {
    const normalized = normalizeSnapshot(snapshot);
    const safeSnapshotId = assertSafeSnapshotId(normalized.snapshotId);
    const filePath = filePathForSnapshot({
      workspaceRoot: resolvedWorkspaceRoot,
      snapshotId: safeSnapshotId,
    });
    const stored = buildOperatorDashboardSnapshot(normalized);
    await prepareSafeTarget({ fsImpl, root: resolvedWorkspaceRoot, target: filePath });
    await fsImpl.writeFile(filePath, jsonContent(stored), 'utf8');
    return {
      snapshot: stored,
      snapshotId: stored.snapshotId,
      filePath,
    };
  }

  async function loadSnapshot(snapshotId) {
    const safeSnapshotId = assertSafeSnapshotId(snapshotId);
    const filePath = filePathForSnapshot({
      workspaceRoot: resolvedWorkspaceRoot,
      snapshotId: safeSnapshotId,
    });
    await assertNoSymlinkAncestors({ fsImpl, root: resolvedWorkspaceRoot, target: filePath });
    const raw = await fsImpl.readFile(filePath, 'utf8');
    return buildOperatorDashboardSnapshot(JSON.parse(raw));
  }

  async function listSnapshotIds() {
    try {
      await assertNoSymlinkAncestors({
        fsImpl,
        root: resolvedWorkspaceRoot,
        target: path.join(root, 'placeholder.json'),
      });
      const entries = await fsImpl.readdir(root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name.slice(0, -'.json'.length))
        .filter((snapshotId) => SAFE_SNAPSHOT_ID.test(snapshotId))
        .sort();
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  return {
    root,
    saveSnapshot,
    loadSnapshot,
    listSnapshotIds,
  };
}
