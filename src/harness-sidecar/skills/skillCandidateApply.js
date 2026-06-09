import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { deleteCapabilityRecord, saveCapabilityRecord } from '../capabilities/capabilityStore.js';
import { evaluatePromotion } from '../meta/promotionPolicy.js';
import { readSkillCandidate } from './skillCandidateStore.js';

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GENERATED_PACKAGE_ID = 'generated-skills';

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

function isInsideWorkspace(workspaceRoot, candidatePath) {
  const relative = path.relative(workspaceRoot, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveInsideWorkspace(workspaceRoot, relativeOrAbsolutePath, label) {
  const resolved = path.isAbsolute(relativeOrAbsolutePath)
    ? path.resolve(relativeOrAbsolutePath)
    : path.resolve(workspaceRoot, relativeOrAbsolutePath);
  if (!isInsideWorkspace(workspaceRoot, resolved)) {
    throw new Error(`${label} points outside workspace`);
  }
  return resolved;
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

function installedSkillPath(workspaceRoot, skillId) {
  return path.join(
    workspaceRoot,
    '.harness',
    'packages',
    GENERATED_PACKAGE_ID,
    'skills',
    assertSafeId(skillId, 'skill id'),
    'SKILL.md',
  );
}

function capabilityIdForSkill(skillId) {
  return `${GENERATED_PACKAGE_ID}:skill:${assertSafeId(skillId, 'skill id')}`;
}

async function updateCandidateRecord({ workspaceRoot, candidateId, patch }) {
  const metadataPath = candidateMetadataPath(workspaceRoot, candidateId);
  const current = JSON.parse(await readFile(metadataPath, 'utf8'));
  const updated = {
    ...current,
    ...patch,
    rollback: {
      ...(current.rollback || {}),
      ...(patch.rollback || {}),
    },
  };
  await writeFile(metadataPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return updated;
}

function assertPromotable({ candidate, approvals, baselineFrontier, skillPolicy }) {
  const decision = evaluatePromotion({
    candidateRun: candidate,
    baselineFrontier,
    approvals,
    skillPolicy,
  });
  if (decision.status !== 'promoted') {
    throw new Error(`Skill candidate is not promotable: ${decision.reasons.join(', ')}`);
  }
  return decision;
}

export async function applyApprovedSkillCandidate({
  workspaceRoot,
  candidateId,
  approvals = [],
  baselineFrontier = [],
  skillPolicy = {},
} = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const safeCandidateId = assertSafeId(candidateId, 'candidateId');
  const candidate = await readSkillCandidate({ workspaceRoot: root, candidateId: safeCandidateId });
  const skillId = assertSafeId(candidate.skill?.id || safeCandidateId, 'skill id');
  const promotion = assertPromotable({
    candidate,
    approvals,
    baselineFrontier,
    skillPolicy,
  });

  const destinationPath = resolveInsideWorkspace(root, installedSkillPath(root, skillId), 'installed skill path');
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, candidate.skillMarkdown, 'utf8');

  const capability = await saveCapabilityRecord({
    workspaceRoot: root,
    record: {
      id: capabilityIdForSkill(skillId),
      type: 'skill',
      capabilityId: skillId,
      packageId: GENERATED_PACKAGE_ID,
      packageName: 'Generated Skills',
      packageVersion: '0.0.0-workspace',
      name: candidate.skill?.name || skillId,
      enabled: true,
      path: destinationPath,
      pathOrCommandOrUrl: destinationPath,
      approvalMode: 'inherit',
      metadata: {
        candidateId: safeCandidateId,
        sourceSkillSnapshotId: candidate.source?.sourceSkillSnapshotId || candidate.lineage?.sourceSnapshotId || null,
        appliedBy: 'skill_candidate_apply',
      },
    },
  });

  const updatedCandidate = await updateCandidateRecord({
    workspaceRoot: root,
    candidateId: safeCandidateId,
    patch: {
      status: 'applied',
      appliedAt: new Date().toISOString(),
      rollback: {
        available: true,
        packageId: GENERATED_PACKAGE_ID,
        installRecordId: capability.id,
        path: destinationPath,
      },
    },
  });

  return {
    candidate: updatedCandidate,
    capability,
    promotion,
    installPath: destinationPath,
  };
}

export async function rollbackAppliedSkillCandidate({ workspaceRoot, candidateId } = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const safeCandidateId = assertSafeId(candidateId, 'candidateId');
  const candidate = await readSkillCandidate({ workspaceRoot: root, candidateId: safeCandidateId });
  const skillId = assertSafeId(candidate.skill?.id || safeCandidateId, 'skill id');
  const capabilityId = candidate.rollback?.installRecordId || capabilityIdForSkill(skillId);
  const targetPath = resolveInsideWorkspace(
    root,
    candidate.rollback?.path || installedSkillPath(root, skillId),
    'rollback skill path',
  );

  await deleteCapabilityRecord({ workspaceRoot: root, capabilityId });
  await rm(path.dirname(targetPath), { recursive: true, force: true });
  const updatedCandidate = await updateCandidateRecord({
    workspaceRoot: root,
    candidateId: safeCandidateId,
    patch: {
      status: 'rolled_back',
      rolledBackAt: new Date().toISOString(),
      rollback: {
        available: false,
        installRecordId: null,
      },
    },
  });

  return {
    candidate: updatedCandidate,
    removedCapabilityId: capabilityId,
    removedPath: targetPath,
  };
}
