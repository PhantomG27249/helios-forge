import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SAFE_CANDIDATE_ID = /^vg_[A-Za-z0-9_-]+$/;

function assertWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
}

function assertSafeCandidateId(candidateId) {
  if (typeof candidateId !== 'string' || !SAFE_CANDIDATE_ID.test(candidateId)) {
    throw new Error(`Unsafe candidate id: ${candidateId || ''}`);
  }
  return candidateId;
}

function getArchiveRoot(workspaceRoot) {
  assertWorkspaceRoot(workspaceRoot);
  return path.join(workspaceRoot, '.harness', 'meta', 'verifier-candidates');
}

function candidateDir(workspaceRoot, candidateId) {
  return path.join(getArchiveRoot(workspaceRoot), assertSafeCandidateId(candidateId));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function archiveVerifierCandidate({ workspaceRoot, genome, run = {}, decision = {} } = {}) {
  assertWorkspaceRoot(workspaceRoot);
  const candidateId = assertSafeCandidateId(genome?.genomeId || run.candidateId);
  if (run.candidateId && run.candidateId !== candidateId) {
    throw new Error(`Verifier candidate id mismatch: ${candidateId} !== ${run.candidateId}`);
  }

  const dir = candidateDir(workspaceRoot, candidateId);
  const metrics = run.metrics || {};
  const cases = Array.isArray(run.cases) ? run.cases : [];
  const record = {
    schemaVersion: 1,
    candidateId,
    archivedAt: run.completedAt || decision.decidedAt || null,
    genome,
    metrics,
    cases,
    decision,
  };

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'genome.json'), `${JSON.stringify(genome, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dir, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dir, 'decision.json'), `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  return record;
}

export async function listVerifierCandidates({ workspaceRoot } = {}) {
  assertWorkspaceRoot(workspaceRoot);
  const root = getArchiveRoot(workspaceRoot);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_CANDIDATE_ID.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    records.push({
      schemaVersion: 1,
      candidateId: entry.name,
      genome: await readJson(path.join(dir, 'genome.json')),
      metrics: await readJson(path.join(dir, 'metrics.json')),
      cases: await readJson(path.join(dir, 'cases.json')),
      decision: await readJson(path.join(dir, 'decision.json')),
    });
  }

  records.sort((left, right) => {
    const leftTime = left.decision?.decidedAt || left.genome?.mutation?.createdAt || '';
    const rightTime = right.decision?.decidedAt || right.genome?.mutation?.createdAt || '';
    const timeOrder = String(rightTime).localeCompare(String(leftTime));
    if (timeOrder !== 0) return timeOrder;
    return String(left.candidateId).localeCompare(String(right.candidateId));
  });
  return records;
}
