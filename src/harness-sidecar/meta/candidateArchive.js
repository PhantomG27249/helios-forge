import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const CANDIDATE_RECORD_FILE = 'candidate.json';
const SAFE_CANDIDATE_ID = /^[A-Za-z0-9_-]+$/;

function assertWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
}

function assertSafeCandidateId(candidateId) {
  if (typeof candidateId !== 'string' || !SAFE_CANDIDATE_ID.test(candidateId)) {
    throw new Error(`Unsafe candidate id: ${candidateId || ''}`);
  }
  return candidateId;
}

function getRecordPath(workspaceRoot, candidateId) {
  const safeId = assertSafeCandidateId(candidateId);
  return path.join(getCandidateArchiveRoot(workspaceRoot), safeId, CANDIDATE_RECORD_FILE);
}

function stableRecord({
  candidateId,
  archivedAt,
  candidate = {},
  candidateRun = {},
  traceSummary = {},
  preference = {},
}) {
  return {
    schemaVersion: 1,
    candidateId,
    archivedAt,
    candidate: {
      ...candidate,
      candidateId,
    },
    candidateRun: {
      ...candidateRun,
      candidateId,
    },
    traceSummary,
    preference,
  };
}

export function getCandidateArchiveRoot(workspaceRoot) {
  assertWorkspaceRoot(workspaceRoot);
  return path.join(workspaceRoot, '.harness', 'meta', 'candidates');
}

export async function archiveCandidate({
  workspaceRoot,
  candidate = {},
  candidateRun = {},
  traceSummary = {},
  preference = {},
} = {}) {
  assertWorkspaceRoot(workspaceRoot);
  const candidateId = assertSafeCandidateId(candidate.candidateId || candidateRun.candidateId);
  const archivedAt = candidate.archivedAt
    || candidateRun.archivedAt
    || candidateRun.evaluatedAt
    || preference.archivedAt
    || null;
  const record = stableRecord({
    candidateId,
    archivedAt,
    candidate,
    candidateRun,
    traceSummary,
    preference,
  });
  const recordPath = getRecordPath(workspaceRoot, candidateId);
  const recordDir = path.dirname(recordPath);

  await mkdir(recordDir, { recursive: true });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await writeFile(path.join(recordDir, 'proposal.json'), `${JSON.stringify(record.candidate, null, 2)}\n`, 'utf8');
  await writeFile(path.join(recordDir, 'metrics.json'), `${JSON.stringify(record.candidateRun, null, 2)}\n`, 'utf8');
  await writeFile(path.join(recordDir, 'trace-summary.json'), `${JSON.stringify(record.traceSummary, null, 2)}\n`, 'utf8');
  await writeFile(path.join(recordDir, 'preference.json'), `${JSON.stringify(record.preference, null, 2)}\n`, 'utf8');
  return record;
}

export async function readArchivedCandidate({ workspaceRoot, candidateId } = {}) {
  assertWorkspaceRoot(workspaceRoot);
  const recordPath = getRecordPath(workspaceRoot, candidateId);
  return JSON.parse(await readFile(recordPath, 'utf8'));
}

export async function listArchivedCandidates({ workspaceRoot, limit } = {}) {
  assertWorkspaceRoot(workspaceRoot);
  const archiveRoot = getCandidateArchiveRoot(workspaceRoot);
  let entries;

  try {
    entries = await readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_CANDIDATE_ID.test(entry.name)) continue;
    records.push(await readArchivedCandidate({ workspaceRoot, candidateId: entry.name }));
  }

  records.sort((left, right) => {
    const timeOrder = String(right.archivedAt || '').localeCompare(String(left.archivedAt || ''));
    if (timeOrder !== 0) return timeOrder;
    return String(left.candidateId || '').localeCompare(String(right.candidateId || ''));
  });

  if (Number.isInteger(limit) && limit >= 0) {
    return records.slice(0, limit);
  }
  return records;
}
