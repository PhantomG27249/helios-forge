import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const CANDIDATE_RECORD_FILE = 'candidate.json';
const SAFE_LOCAL_ID = /^[A-Za-z0-9_-]+$/;

function assertWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
}

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_LOCAL_ID.test(value)) {
    throw new Error(`Unsafe ${label}: ${value || ''}`);
  }
  return value;
}

function assertInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes local candidate archive: ${child}`);
  }
}

export function getLocalCandidateArchiveRoot(workspaceRoot) {
  assertWorkspaceRoot(workspaceRoot);
  return path.join(workspaceRoot, '.harness', 'meta', 'local-candidates');
}

export function getLocalCandidateRecordPath({ workspaceRoot, cellId, candidateId } = {}) {
  const archiveRoot = getLocalCandidateArchiveRoot(workspaceRoot);
  const safeCellId = assertSafeId(cellId, 'cell id');
  const safeCandidateId = assertSafeId(candidateId, 'candidate id');
  const recordPath = path.join(archiveRoot, safeCellId, safeCandidateId, CANDIDATE_RECORD_FILE);
  assertInside(archiveRoot, recordPath);
  return recordPath;
}

function stableLocalRecord({
  cellId,
  candidateId,
  archivedAt,
  candidate = {},
  evidence = {},
}) {
  return {
    schemaVersion: 1,
    cellId,
    candidateId,
    archivedAt,
    candidate: {
      ...candidate,
      candidateId,
    },
    evidence,
    scope: 'local_meta_harness',
  };
}

export async function archiveLocalCandidate({
  workspaceRoot,
  cellId,
  candidate = {},
  evidence = {},
} = {}) {
  assertWorkspaceRoot(workspaceRoot);
  const safeCellId = assertSafeId(cellId, 'cell id');
  const safeCandidateId = assertSafeId(candidate.candidateId, 'candidate id');
  const recordPath = getLocalCandidateRecordPath({
    workspaceRoot,
    cellId: safeCellId,
    candidateId: safeCandidateId,
  });
  const recordDir = path.dirname(recordPath);
  const record = stableLocalRecord({
    cellId: safeCellId,
    candidateId: safeCandidateId,
    archivedAt: candidate.archivedAt || new Date().toISOString(),
    candidate,
    evidence,
  });

  await mkdir(recordDir, { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  return {
    ...record,
    recordPath,
    recordDir,
  };
}

export async function readLocalCandidate({ workspaceRoot, cellId, candidateId } = {}) {
  const recordPath = getLocalCandidateRecordPath({ workspaceRoot, cellId, candidateId });
  return JSON.parse(await readFile(recordPath, 'utf8'));
}

export async function listLocalCandidates({ workspaceRoot, cellId } = {}) {
  const archiveRoot = getLocalCandidateArchiveRoot(workspaceRoot);
  const safeCellId = assertSafeId(cellId, 'cell id');
  const cellRoot = path.join(archiveRoot, safeCellId);
  assertInside(archiveRoot, cellRoot);

  let entries;
  try {
    entries = await readdir(cellRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_LOCAL_ID.test(entry.name)) continue;
    records.push(await readLocalCandidate({
      workspaceRoot,
      cellId: safeCellId,
      candidateId: entry.name,
    }));
  }

  records.sort((left, right) => {
    const timeOrder = String(right.archivedAt || '').localeCompare(String(left.archivedAt || ''));
    if (timeOrder !== 0) return timeOrder;
    return String(left.candidateId || '').localeCompare(String(right.candidateId || ''));
  });
  return records;
}
