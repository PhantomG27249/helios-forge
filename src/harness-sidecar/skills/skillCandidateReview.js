import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { applyApprovedSkillCandidate } from './skillCandidateApply.js';
import { readSkillCandidate } from './skillCandidateStore.js';

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REDACTED = '[redacted]';
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|credential|password|secret|token)/i;
const PRIVATE_URL_KEY_PATTERN = /(baseurl|endpoint|url|uri)/i;

function requireWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function assertSafeId(id, label = 'id') {
  const value = String(id || '').trim();
  if (!SAFE_ID_PATTERN.test(value) || value.includes('..') || path.isAbsolute(value)) {
    throw new Error(`Unsafe ${label}: ${id || '(empty)'}`);
  }
  return value;
}

function candidateMetadataPath(workspaceRoot, candidateId) {
  return path.join(
    workspaceRoot,
    '.harness',
    'meta',
    'skill-candidates',
    assertSafeId(candidateId, 'candidateId'),
    'candidate.json',
  );
}

async function updateCandidateRecord({ workspaceRoot, candidateId, patch }) {
  const metadataPath = candidateMetadataPath(workspaceRoot, candidateId);
  const current = JSON.parse(await readFile(metadataPath, 'utf8'));
  const updated = {
    ...current,
    ...patch,
    review: {
      ...(current.review || {}),
      ...(patch.review || {}),
    },
  };
  await writeFile(metadataPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}

export function redactSkillCandidatePayload(value) {
  return redactValue(value);
}

export function summarizeSkillCandidate(candidate = {}) {
  return redactValue({
    candidateId: candidate.candidateId,
    status: candidate.status,
    createdAt: candidate.createdAt,
    skill: candidate.skill ? {
      id: candidate.skill.id,
      name: candidate.skill.name,
      path: candidate.skill.path,
    } : null,
    source: candidate.source,
    safety: candidate.safety,
    metrics: candidate.metrics,
    evaluation: candidate.evaluation,
    review: candidate.review,
    rollback: candidate.rollback,
  });
}

export async function approveSkillCandidateForReview({
  workspaceRoot,
  candidateId,
  approver = 'human',
  baselineFrontier = [],
  skillPolicy = {},
} = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const safeCandidateId = assertSafeId(candidateId, 'candidateId');
  const applied = await applyApprovedSkillCandidate({
    workspaceRoot: root,
    candidateId: safeCandidateId,
    approvals: [{ candidateId: safeCandidateId, choice: 'approve', approver }],
    baselineFrontier,
    skillPolicy,
  });
  const candidate = await updateCandidateRecord({
    workspaceRoot: root,
    candidateId: safeCandidateId,
    patch: {
      review: {
        status: 'approved',
        approver,
        approvedAt: new Date().toISOString(),
      },
    },
  });

  return redactValue({
    status: 'applied',
    ...applied,
    candidate,
  });
}

export async function rejectSkillCandidateForReview({
  workspaceRoot,
  candidateId,
  reviewer = 'human',
  reason = 'Rejected during skill candidate review.',
} = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const safeCandidateId = assertSafeId(candidateId, 'candidateId');
  await readSkillCandidate({ workspaceRoot: root, candidateId: safeCandidateId });
  const candidate = await updateCandidateRecord({
    workspaceRoot: root,
    candidateId: safeCandidateId,
    patch: {
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      review: {
        status: 'rejected',
        reviewer,
        reason,
        rejectedAt: new Date().toISOString(),
      },
    },
  });

  return redactValue({
    status: 'rejected',
    candidate,
  });
}

function redactValue(value, keyPath = []) {
  const key = keyPath.at(-1) || '';
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(key)) return REDACTED;
    if (PRIVATE_URL_KEY_PATTERN.test(key) && /private|internal|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value)) {
      return REDACTED;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(entry, [...keyPath, String(index)]));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      SECRET_KEY_PATTERN.test(childKey)
        ? REDACTED
        : redactValue(childValue, [...keyPath, childKey]),
    ]),
  );
}
