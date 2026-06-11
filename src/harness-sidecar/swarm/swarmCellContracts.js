import { normalizeEvolutionLevelRefs } from '../souls/evolutionLevels.js';
import { normalizeSoulRefs } from '../souls/soulEvidence.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizedStringList(value) {
  return asArray(value)
    .flatMap((item) => (typeof item === 'string' ? item.split('\n') : [item]))
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => {
      if (typeof item === 'string') return item.length > 0;
      return item !== undefined && item !== null;
    });
}

function normalizedList(value) {
  return asArray(value).filter((item) => item !== undefined && item !== null);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function legacyTaskSource(output = {}) {
  if (output?.taskOutput && typeof output.taskOutput === 'object' && !Array.isArray(output.taskOutput)) {
    return output.taskOutput;
  }
  return output || {};
}

function legacyEvolutionSource(output = {}) {
  if (output?.evolutionOutput && typeof output.evolutionOutput === 'object' && !Array.isArray(output.evolutionOutput)) {
    return output.evolutionOutput;
  }
  if (output?.evolution && typeof output.evolution === 'object' && !Array.isArray(output.evolution)) {
    return output.evolution;
  }
  return output || {};
}

function soulMetadataFrom(source = {}) {
  return source.soulRefs ?? source.soulRef ?? source.soulMetadata ?? {
    soulId: source.soulId,
    soulVersion: source.soulVersion,
    oversoulVersion: source.oversoulVersion,
    mutationLineage: source.mutationLineage,
  };
}

function evolutionLevelMetadataFrom(source = {}) {
  return source.evolutionLevelRefs
    ?? source.evolutionLevelRef
    ?? source.evolutionLevel
    ?? source.levelRefs
    ?? null;
}

export function normalizeEvolutionOutput(evolution = {}) {
  const source = evolution && typeof evolution === 'object' && !Array.isArray(evolution) ? evolution : {};
  const durableApplyApproved = false;
  const soulRefs = normalizeSoulRefs(soulMetadataFrom(source));
  const evolutionLevelRefs = normalizeEvolutionLevelRefs(evolutionLevelMetadataFrom(source));

  return {
    hardCaseTags: normalizedStringList(source.hardCaseTags ?? source.hardCases ?? source.tags),
    evidenceRefs: normalizedStringList(source.evidenceRefs ?? source.evidenceReferences),
    ...(soulRefs ? { soulRefs } : {}),
    ...(evolutionLevelRefs.length ? { evolutionLevelRefs } : {}),
    roleWeakness: source.roleWeakness ?? null,
    suggestedProfileChange: source.suggestedProfileChange ?? null,
    suggestedSkill: source.suggestedSkill ?? null,
    suggestedCodeChange: source.suggestedCodeChange ?? null,
    suggestedVerifierChange: source.suggestedVerifierChange ?? null,
    suggestedPolicyChange: source.suggestedPolicyChange ?? null,
    suggestedMemoryPolicyChange: source.suggestedMemoryPolicyChange ?? null,
    suggestedMemoryChange: source.suggestedMemoryChange ?? null,
    memoryProposals: normalizedList(source.memoryProposals),
    durableApplyRequested: Boolean(source.durableApplyRequested),
    durableApplyApproved,
  };
}

export function normalizeTaskOutput(output = {}) {
  const source = legacyTaskSource(output);
  const soulRefs = normalizeSoulRefs(soulMetadataFrom(source));
  const evolutionLevelRefs = normalizeEvolutionLevelRefs(evolutionLevelMetadataFrom(source));
  return {
    ...source,
    summary: nonEmptyString(source.summary) || '',
    verifierEvidence: normalizedStringList(source.verifierEvidence),
    evidence: normalizedStringList(source.evidence),
    evidenceRefs: normalizedStringList(source.evidenceRefs),
    ...(soulRefs ? { soulRefs } : {}),
    ...(evolutionLevelRefs.length ? { evolutionLevelRefs } : {}),
  };
}

export function normalizeSwarmCellOutput(output = {}) {
  return {
    taskOutput: normalizeTaskOutput(output),
    evolutionOutput: normalizeEvolutionOutput(legacyEvolutionSource(output)),
  };
}

export function validateSwarmCellContract(output = {}) {
  const taskOutput = normalizeTaskOutput(output);
  const evolutionSource = legacyEvolutionSource(output);
  const evolutionOutput = normalizeEvolutionOutput(evolutionSource);
  const reasons = [];

  if (evolutionSource?.durableApplyApproved === true) {
    reasons.push('local_durable_approval_forbidden');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    taskOutput,
    evolutionOutput,
  };
}
