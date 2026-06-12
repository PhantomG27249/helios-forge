import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function subgoalId(subgoal = {}) {
  return String(subgoal.id ?? subgoal.subgoalId ?? 'subgoal');
}

function requirementText(subgoal = {}) {
  return asArray(subgoal.requiredEvidence ?? subgoal.requires ?? subgoal.requirement ?? subgoal.command ?? subgoal.id)
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
}

function evidenceText(entry) {
  if (typeof entry === 'string') return entry.toLowerCase();
  return [
    entry?.id,
    entry?.goalId,
    entry?.subgoalId,
    entry?.command,
    entry?.summary,
    entry?.note,
    entry?.text,
  ].filter(Boolean).join(' ').toLowerCase();
}

function deterministicSatisfaction({ subgoal, evidence }) {
  const requirements = requirementText(subgoal);
  if (requirements.length === 0) return false;
  const haystack = asArray(evidence).map(evidenceText);
  return requirements.every((requirement) => haystack.some((entry) => entry.includes(requirement)));
}

function provenanceIdOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return entry.provenanceId ?? entry.sourceId ?? entry.source ?? entry.traceId ?? entry.id ?? null;
}

function provenanceIdsFromEvidence(evidence = []) {
  return [...new Set(asArray(evidence).map(provenanceIdOf).filter(Boolean).map(String))].sort();
}

function clampConfidence(value, maxConfidence = 0.75) {
  const number = Number(value);
  const bounded = Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
  return Math.min(bounded, Math.max(0, Math.min(1, Number(maxConfidence) || 0.75)));
}

async function invokeModelProvider(modelProvider, input) {
  if (typeof modelProvider === 'function') return modelProvider(input);
  if (typeof modelProvider?.judge === 'function') return modelProvider.judge(input);
  if (typeof modelProvider?.complete === 'function') return modelProvider.complete(input);
  return null;
}

function sanitizedReasons(values = []) {
  return asArray(values)
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map(String)
    .slice(0, 8);
}

function baseResult({ subgoal, status, satisfied, confidence, reasons = [] }) {
  return {
    subgoalId: subgoalId(subgoal),
    status,
    satisfied: Boolean(satisfied),
    confidence,
    reasons,
    evidenceOnly: true,
    promotionAuthority: false,
    canPromote: false,
  };
}

export async function judgeDenseSubgoalWithModel({
  subgoal,
  evidence,
  modelProvider,
  policy,
} = {}) {
  const normalizedPolicy = policy && typeof policy === 'object' ? policy : {};
  const fallbackSatisfied = deterministicSatisfaction({ subgoal, evidence });
  if (normalizedPolicy.enabled !== true) {
    return {
      ...baseResult({
        subgoal,
        status: 'deterministic_fallback',
        satisfied: fallbackSatisfied,
        confidence: 0.5,
        reasons: ['model_assistance_disabled'],
      }),
      modelAssisted: false,
      deterministicFallback: true,
    };
  }

  const provenanceIds = provenanceIdsFromEvidence(evidence);
  if (normalizedPolicy.requireProvenance === true && provenanceIds.length === 0) {
    return {
      ...baseResult({
        subgoal,
        status: 'insufficient_provenance',
        satisfied: false,
        confidence: 0,
        reasons: ['missing_provenance'],
      }),
      modelAssisted: false,
      deterministicFallback: fallbackSatisfied,
      provenanceIds: [],
    };
  }

  const quarantine = quarantineModelVisiblePayload({
    subgoal,
    evidence,
    provenanceIds,
  }, {
    maxStringLength: normalizedPolicy.maxStringLength,
  });
  const providerResult = await invokeModelProvider(modelProvider, {
    subgoal: quarantine.value.subgoal,
    evidence: quarantine.value.evidence,
    provenanceIds: quarantine.value.provenanceIds,
    policy: {
      enabled: true,
      requireProvenance: Boolean(normalizedPolicy.requireProvenance),
      evidenceOnly: true,
      promotionAuthority: false,
    },
  });

  if (!providerResult || typeof providerResult !== 'object') {
    return {
      ...baseResult({
        subgoal,
        status: 'deterministic_fallback',
        satisfied: fallbackSatisfied,
        confidence: 0.5,
        reasons: ['model_provider_unavailable'],
      }),
      modelAssisted: false,
      deterministicFallback: true,
      provenanceIds,
      quarantine,
    };
  }

  const satisfied = providerResult.satisfied === true || providerResult.status === 'satisfied';
  return {
    ...baseResult({
      subgoal,
      status: satisfied ? 'satisfied' : 'missing',
      satisfied,
      confidence: clampConfidence(providerResult.confidence, normalizedPolicy.maxConfidence),
      reasons: sanitizedReasons(providerResult.reasons ?? providerResult.reason),
    }),
    modelAssisted: true,
    deterministicFallback: fallbackSatisfied,
    provenanceIds: [...new Set(asArray(providerResult.provenanceIds).filter(Boolean).map(String))]
      .filter((id) => provenanceIds.includes(id))
      .sort(),
    quarantine,
  };
}
