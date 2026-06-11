import { createHarnessVariantWorkspace } from '../meta/harnessVariantWorkspace.js';
import {
  buildEvolutionLevelEnvelope,
  normalizeEvolutionLevelRef,
  normalizeEvolutionLevelRefs,
} from './evolutionLevels.js';
import { normalizeSoulRefs } from './soulEvidence.js';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`Unsafe ${label}: ${value || ''}`);
  }
  return value;
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function stripAuthorityFields(value) {
  const {
    applied,
    durableApplyApproved,
    promotion,
    promotionAllowed,
    promotionAuthority,
    status,
    ...rest
  } = normalizeObject(value);
  return rest;
}

function normalizeTarget(value) {
  return String(value || 'soul').trim().toLowerCase() === 'oversoul' ? 'oversoul' : 'soul';
}

function markdownPathForCandidate(candidate) {
  const candidateId = assertSafeId(candidate.candidateId, 'candidate id');
  if (candidate.target === 'oversoul') {
    return `.harness/souls/oversoul-candidates/${candidateId}/oversoul.md`;
  }
  const soulId = assertSafeId(candidate.soulRefs?.soulId || 'default', 'soul id');
  return `.harness/souls/candidates/${soulId}/${candidateId}/soul.md`;
}

export function createSoulMutationCandidate({
  candidateId,
  target = 'soul',
  operation = 'mutate',
  markdown = '',
  evidenceRefs = [],
  soulRefs,
  evolutionLevel,
  parentLevelRef,
  childLevelRefs = [],
  societyRefs = [],
  ...metadata
} = {}) {
  const safeCandidateId = assertSafeId(candidateId, 'candidate id');
  const normalizedTarget = normalizeTarget(target);
  const safeMetadata = stripAuthorityFields(metadata);
  const refs = normalizeSoulRefs({
    ...safeMetadata,
    ...(normalizeObject(soulRefs)),
  });
  const targetLevel = evolutionLevel || {
    level: normalizedTarget === 'oversoul' ? 'oversoul' : 'subagent_soul',
    levelId: refs?.soulId || safeCandidateId,
    version: refs?.soulVersion,
  };
  const evolutionLevelRef = normalizeEvolutionLevelRef({
    ...targetLevel,
    parentRef: parentLevelRef ?? targetLevel.parentRef,
    childRefs: childLevelRefs ?? targetLevel.childRefs,
  });
  const normalizedSocietyRefs = normalizeEvolutionLevelRefs(societyRefs);

  return {
    ...safeMetadata,
    candidateId: safeCandidateId,
    target: normalizedTarget,
    operation: String(operation || 'mutate').trim() || 'mutate',
    status: 'shadow_only',
    evidenceOnly: true,
    promotionAuthority: false,
    durableApplyApproved: false,
    requiresApproval: true,
    soulRefs: refs,
    ...(evolutionLevelRef ? { evolutionLevelRef } : {}),
    ...(normalizedSocietyRefs.length ? { societyRefs: normalizedSocietyRefs } : {}),
    ...(evolutionLevelRef ? {
      evolutionEnvelope: buildEvolutionLevelEnvelope({
        level: evolutionLevelRef.level,
        levelId: evolutionLevelRef.levelId,
        version: evolutionLevelRef.version,
        parentRef: evolutionLevelRef.parentRef,
        childRefs: evolutionLevelRef.childRefs,
        lineagePath: evolutionLevelRef.lineagePath,
        soulRefs: refs,
        societyRefs: normalizedSocietyRefs,
      }),
    } : {}),
    evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs.map(String).filter(Boolean) : [String(evidenceRefs)].filter(Boolean),
    markdown: String(markdown || ''),
  };
}

export async function createSoulVariantWorkspace({
  workspaceRoot,
  cycleId,
  candidate,
  config = {},
  traceManifest = {},
  metricManifest = {},
  traceArtifacts = {},
  metricArtifacts = {},
} = {}) {
  const normalizedCandidate = {
    ...createSoulMutationCandidate(candidate),
    ...stripAuthorityFields(candidate),
    status: 'shadow_only',
    evidenceOnly: true,
    promotionAuthority: false,
    durableApplyApproved: false,
  };
  normalizedCandidate.soulRefs = normalizeSoulRefs(candidate?.soulRefs)
    ?? normalizedCandidate.soulRefs
    ?? normalizeSoulRefs(candidate)
    ?? null;
  const sourcePath = markdownPathForCandidate(normalizedCandidate);

  return createHarnessVariantWorkspace({
    workspaceRoot,
    cycleId,
    candidate: normalizedCandidate,
    sourceFiles: {
      [sourcePath]: normalizedCandidate.markdown || '',
    },
    config: {
      ...normalizeObject(config),
      soulMutation: {
        target: normalizedCandidate.target,
        operation: normalizedCandidate.operation,
        evidenceOnly: true,
        promotionAuthority: false,
      },
    },
    traceManifest,
    metricManifest,
    traceArtifacts,
    metricArtifacts,
    lineage: {
      soulRefs: normalizedCandidate.soulRefs,
      evolutionLevelRef: normalizedCandidate.evolutionLevelRef,
      societyRefs: normalizedCandidate.societyRefs || [],
      mutationLineage: normalizedCandidate.soulRefs?.mutationLineage || [],
    },
  });
}
