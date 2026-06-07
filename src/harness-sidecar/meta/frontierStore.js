import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

function defaultFrontier() {
  return {
    schemaVersion: 1,
    baselineFrontier: [],
    candidates: {
      accepted: [],
      rejected: [],
    },
    promotionDecisions: [],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hashId(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 8);
}

export function sanitizeCandidateId(candidateId) {
  const raw = String(candidateId || '').trim();
  if (/^[A-Za-z0-9_-]+$/.test(raw)) {
    return raw;
  }

  const normalized = raw
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${normalized || 'candidate'}_${hashId(raw)}`;
}

export function getFrontierPath(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.join(workspaceRoot, '.harness', 'meta', 'frontier.json');
}

function normalizeMetrics(record = {}) {
  return {
    ...record,
    candidateId: sanitizeCandidateId(record.candidateId),
  };
}

function normalizeFrontier(frontier = {}) {
  const base = defaultFrontier();
  return {
    schemaVersion: frontier.schemaVersion || base.schemaVersion,
    baselineFrontier: normalizeList(frontier.baselineFrontier).map(normalizeMetrics),
    candidates: {
      accepted: normalizeList(frontier.candidates?.accepted).map(normalizeMetrics),
      rejected: normalizeList(frontier.candidates?.rejected).map(normalizeMetrics),
    },
    promotionDecisions: normalizeList(frontier.promotionDecisions).map((decision) => ({
      ...decision,
      candidateId: sanitizeCandidateId(decision.candidateId),
    })),
  };
}

function normalizeStoredCandidate(candidate = {}, candidateRun = {}) {
  const candidateId = sanitizeCandidateId(
    candidate.candidateId || candidateRun.candidateId,
  );
  return {
    candidateId,
    target: candidate.target,
    rationale: candidate.rationale,
    metrics: candidateRun.metrics || {},
    smokePassed: Boolean(candidateRun.smokePassed),
  };
}

function replaceCandidate(candidates, record) {
  return [
    ...candidates.filter((candidate) => candidate.candidateId !== record.candidateId),
    record,
  ];
}

export function createFrontierStore({ workspaceRoot } = {}) {
  const filePath = getFrontierPath(workspaceRoot);

  async function save(frontier) {
    const stored = normalizeFrontier(frontier);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    return stored;
  }

  async function load() {
    try {
      return normalizeFrontier(JSON.parse(await readFile(filePath, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return defaultFrontier();
      throw error;
    }
  }

  async function setBaselineFrontier(baselineFrontier = []) {
    const frontier = await load();
    frontier.baselineFrontier = normalizeList(baselineFrontier).map(normalizeMetrics);
    return save(frontier);
  }

  async function recordDecision({
    candidate = {},
    candidateRun = {},
    decision = {},
    proposal = null,
    applied = null,
  } = {}) {
    const frontier = await load();
    const candidateId = sanitizeCandidateId(
      candidate.candidateId || candidateRun.candidateId || decision.candidateId,
    );
    const safeCandidate = { ...candidate, candidateId };
    const safeRun = { ...candidateRun, candidateId };
    const safeDecision = { ...decision, candidateId };
    const status = safeDecision.status || 'rejected';
    const candidateRecord = normalizeStoredCandidate(safeCandidate, safeRun);

    frontier.promotionDecisions.push({
      candidateId,
      status,
      reasons: normalizeList(safeDecision.reasons),
      metrics: safeRun.metrics || safeDecision.metrics || {},
      proposalId: proposal?.proposalId,
      applied: applied || null,
      decidedAt: new Date().toISOString(),
    });

    if (status === 'promoted') {
      frontier.candidates.accepted = replaceCandidate(frontier.candidates.accepted, candidateRecord);
      frontier.candidates.rejected = frontier.candidates.rejected
        .filter((record) => record.candidateId !== candidateId);
    } else {
      frontier.candidates.rejected = replaceCandidate(frontier.candidates.rejected, candidateRecord);
      frontier.candidates.accepted = frontier.candidates.accepted
        .filter((record) => record.candidateId !== candidateId);
    }

    return save(frontier);
  }

  return {
    filePath,
    load,
    save,
    setBaselineFrontier,
    recordDecision,
  };
}
