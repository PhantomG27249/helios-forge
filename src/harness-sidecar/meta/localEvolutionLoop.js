import { blockLocalDurablePromotion } from './localPromotionBlocker.js';

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

function safeIdPart(value, fallback) {
  const normalized = String(value || fallback || 'cell').replace(/[^A-Za-z0-9_-]/g, '_');
  return normalized.length > 0 ? normalized : fallback;
}

function inferMutationType(evolutionOutput = {}) {
  if (evolutionOutput.suggestedCodeChange) return 'code_change_suggestion';
  if (evolutionOutput.suggestedVerifierChange) return 'verifier_adjustment';
  if (evolutionOutput.suggestedMemoryPolicyChange || evolutionOutput.suggestedMemoryChange) return 'memory_policy_adjustment';
  if (evolutionOutput.suggestedPolicyChange) return 'policy_adjustment';
  if (evolutionOutput.suggestedProfileChange) return 'profile_adjustment';
  return 'hard_case_profile_update';
}

function inferTarget(evolutionOutput = {}) {
  if (evolutionOutput.suggestedCodeChange) return 'code';
  if (evolutionOutput.suggestedVerifierChange) return 'verifier';
  if (evolutionOutput.suggestedMemoryPolicyChange || evolutionOutput.suggestedMemoryChange) return 'memory_policy';
  if (evolutionOutput.suggestedPolicyChange) return 'policy';
  if (evolutionOutput.suggestedProfileChange) return 'profile';
  return 'local_profile';
}

function buildCandidate({ cellId, attempt = {}, evolutionOutput = {}, hardCaseTag, index }) {
  const safeCellId = safeIdPart(cellId, 'cell');
  return blockLocalDurablePromotion({
    candidateId: `local_${safeCellId}_${index}`,
    cellId,
    mutationType: inferMutationType(evolutionOutput),
    target: inferTarget(evolutionOutput),
    scope: 'local',
    hardCaseTags: [hardCaseTag],
    suggestedProfileChange: evolutionOutput.suggestedProfileChange ?? null,
    suggestedCodeChange: evolutionOutput.suggestedCodeChange ?? null,
    suggestedVerifierChange: evolutionOutput.suggestedVerifierChange ?? null,
    suggestedMemoryPolicyChange: evolutionOutput.suggestedMemoryPolicyChange ?? null,
    suggestedMemoryChange: evolutionOutput.suggestedMemoryChange ?? null,
    suggestedPolicyChange: evolutionOutput.suggestedPolicyChange ?? null,
    durableApplyRequested: Boolean(evolutionOutput.durableApplyRequested),
    durableApplyApproved: false,
    evidence: {
      attemptId: attempt.attemptId ?? null,
      status: attempt.status ?? null,
      evidenceRefs: normalizedStringList(evolutionOutput.evidenceRefs),
      verifierEvidence: normalizedStringList(attempt.verifierEvidence),
      traceRefs: normalizedStringList(evolutionOutput.traceRefs),
    },
  });
}

export function runLocalEvolutionLoop({ cellId, attempt = {} } = {}) {
  const evolutionOutput = attempt.evolutionOutput || {};
  const hardCaseTags = normalizedStringList(evolutionOutput.hardCaseTags);
  const candidates = hardCaseTags.map((hardCaseTag, index) => buildCandidate({
    cellId,
    attempt,
    evolutionOutput,
    hardCaseTag,
    index: index + 1,
  }));

  return {
    schemaVersion: 1,
    cellId,
    attemptId: attempt.attemptId ?? null,
    hardCaseTags,
    candidates,
  };
}
