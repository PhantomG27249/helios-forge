import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

const VERDICTS = new Set(['supported', 'contradicted', 'conflicted', 'insufficient_evidence']);
const KEYED_WINDOWS_PATH_PATTERN = /\b([A-Za-z0-9_.-]+)([:=])([A-Za-z]:[\\/][^\s,;'"<>]*)/g;
const AUTHORITY_TEXT_PATTERN = /\b(authority|canPromote|promotionAllowed|canApply|apply|approved|verifierBypass)\s*[:=]\s*([^\s,;'"<>]+)/gi;

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.flatMap(normalizeList) : [value].filter(Boolean);
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function boundedConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function provenanceId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return value.id
      || value.passageId
      || value.provenanceId
      || value.provenanceRef
      || value.ref
      || value.sourceId
      || value.traceId
      || null;
  }
  return String(value);
}

function inputProvenanceRefs(input = {}) {
  return unique([
    ...normalizeList(input.provenanceRefs),
    ...normalizeList(input.provenanceIds),
    ...normalizeList(input.passageIds),
    ...normalizeList(input.provenance),
    ...normalizeList(input.refs),
  ].map(provenanceId).filter(Boolean));
}

function redactKeyedDrivePaths(value) {
  let redacted = String(value);
  const reasons = new Set();
  redacted = redacted.replace(KEYED_WINDOWS_PATH_PATTERN, (_match, key, operator) => {
    reasons.add('unsafe_path_value');
    return `${key}${operator}[redacted:path]`;
  });
  redacted = redacted.replace(AUTHORITY_TEXT_PATTERN, (_match, key) => {
    reasons.add('authority_claim_removed');
    return `${key}=[redacted:authority]`;
  });
  return {
    value: redacted,
    reasons: [...reasons],
  };
}

function sanitizeReasons(reasons) {
  const preRedacted = normalizeList(reasons).map(redactKeyedDrivePaths);
  const quarantine = quarantineModelVisiblePayload({ reasons: preRedacted.map((item) => item.value) }, { maxStringLength: 600 });
  return {
    reasons: normalizeList(quarantine.value?.reasons).map(String),
    quarantineReasons: unique([...quarantine.reasons, ...preRedacted.flatMap((item) => item.reasons)]),
  };
}

function sanitizeProvenanceRef(ref) {
  const preRedacted = redactKeyedDrivePaths(ref);
  const quarantine = quarantineModelVisiblePayload({ provenanceRef: preRedacted.value }, { maxStringLength: 600 });
  return {
    ref: String(quarantine.value?.provenanceRef ?? ''),
    reasons: unique([...quarantine.reasons, ...preRedacted.reasons]),
  };
}

function provenanceRefReasons(reason, ref) {
  const sanitizedRef = sanitizeProvenanceRef(ref);
  return [`${reason}:${sanitizedRef.ref}`, ...sanitizedRef.reasons];
}

function staleStatus(value = {}) {
  return value.stale === true
    || value.superseded === true
    || Boolean(value.supersededBy)
    || value.status === 'stale'
    || value.sourceStatus === 'stale';
}

function factTokens(fact = {}) {
  return [fact.subject, fact.predicate || fact.relation, fact.object]
    .flatMap((value) => String(value || '').toLowerCase().split(/[^a-z0-9_]+/))
    .filter((token) => token.length >= 2);
}

function passageText(passage = {}) {
  return String(passage.text || passage.content || passage.summary || '').toLowerCase();
}

function passageSupportsFact(passage = {}, fact = {}) {
  const text = passageText(passage);
  if (!text) return false;
  const tokens = factTokens(fact);
  if (tokens.length === 0) return false;
  const objectTokens = String(fact.object || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 2);
  if (objectTokens.length > 0 && objectTokens.every((token) => text.includes(token))) return true;
  return tokens.filter((token) => text.includes(token)).length >= Math.min(2, tokens.length);
}

function deterministicEvidence(conflict = {}, passages = []) {
  const newSupport = passages.filter((passage) => passageSupportsFact(passage, conflict.newFact));
  const existingSupport = passages.filter((passage) => passageSupportsFact(passage, conflict.existingFact));
  const refs = unique([...newSupport, ...existingSupport].map(provenanceId).filter(Boolean));

  if (newSupport.length > 0 && existingSupport.length === 0) {
    return {
      verdict: 'supported',
      confidence: 0.55,
      provenanceRefs: refs,
      reasons: ['deterministic_passages_support_new_fact'],
    };
  }
  if (existingSupport.length > 0 && newSupport.length === 0) {
    return {
      verdict: 'contradicted',
      confidence: 0.55,
      provenanceRefs: refs,
      reasons: ['deterministic_passages_support_existing_fact'],
    };
  }
  if (existingSupport.length > 0 && newSupport.length > 0) {
    return {
      verdict: 'conflicted',
      confidence: 0.5,
      provenanceRefs: refs,
      reasons: ['deterministic_passages_support_both_facts'],
    };
  }
  return {
    verdict: 'insufficient_evidence',
    confidence: 0,
    provenanceRefs: [],
    reasons: ['no_passage_support_detected'],
  };
}

export function normalizeResolutionEvidence(input, { knownProvenanceRefs = [], blockedProvenanceRefs = [] } = {}) {
  const known = new Set(normalizeList(knownProvenanceRefs).map(String));
  const blocked = new Set(normalizeList(blockedProvenanceRefs).map(String));
  const rawRefs = inputProvenanceRefs(input);
  const reasons = [];
  let verdict = VERDICTS.has(input?.verdict) ? input.verdict : 'insufficient_evidence';
  let confidence = boundedConfidence(input?.confidence);

  if (input?.verdict && !VERDICTS.has(input.verdict)) reasons.push(`invalid_verdict:${input.verdict}`);

  const provenanceRefs = [];
  for (const ref of rawRefs) {
    if (blocked.has(ref)) {
      reasons.push(...provenanceRefReasons('stale_provenance_ref', ref));
      continue;
    }
    if (!known.has(ref)) {
      reasons.push(...provenanceRefReasons('unknown_provenance_ref', ref));
      continue;
    }
    const sanitizedRef = sanitizeProvenanceRef(ref);
    reasons.push(...sanitizedRef.reasons);
    provenanceRefs.push(sanitizedRef.ref);
  }

  if (input?.promotionAllowed === true || input?.canPromote === true || input?.approved === true || input?.apply === true) {
    reasons.push('authority_claim_removed');
  }

  const sanitized = sanitizeReasons([...(normalizeList(input?.reasons)), ...reasons]);
  const outputReasons = unique([...sanitized.reasons, ...sanitized.quarantineReasons]).sort();

  if (provenanceRefs.length === 0) {
    verdict = 'insufficient_evidence';
    confidence = Math.min(confidence, 0.2);
    if (!outputReasons.includes('missing_guarded_provenance')) outputReasons.push('missing_guarded_provenance');
  }

  return {
    verdict,
    confidence,
    provenanceRefs: unique(provenanceRefs),
    modelEvidenceOnly: true,
    promotionAllowed: false,
    reasons: outputReasons.sort(),
  };
}

export async function runProvenanceResolutionAgents({
  conflict,
  provenancePassages,
  modelResolver,
  policy,
} = {}) {
  const allowStaleEvidence = policy?.allowStaleEvidence === true;
  const passages = normalizeList(provenancePassages);
  const freshPassages = allowStaleEvidence ? passages : passages.filter((passage) => !staleStatus(passage));
  const staleRefs = allowStaleEvidence ? [] : passages.filter(staleStatus).map(provenanceId).filter(Boolean);
  const knownProvenanceRefs = freshPassages.map(provenanceId).filter(Boolean);

  if (!conflict) {
    return normalizeResolutionEvidence({
      verdict: 'insufficient_evidence',
      confidence: 0,
      provenanceRefs: [],
      reasons: ['missing_conflict'],
    }, { knownProvenanceRefs });
  }

  const quarantinedPayload = quarantineModelVisiblePayload({
    conflict,
    provenancePassages: freshPassages,
    policy: {
      allowStaleEvidence,
      evidenceOnly: true,
    },
  });

  const modelInput = {
    ...quarantinedPayload.value,
    modelEvidenceOnly: true,
    promotionAllowed: false,
  };

  const rawEvidence = typeof modelResolver === 'function'
    ? await modelResolver(modelInput)
    : deterministicEvidence(conflict, freshPassages);

  const normalized = normalizeResolutionEvidence(rawEvidence, {
    knownProvenanceRefs,
    blockedProvenanceRefs: staleRefs,
  });

  const runnerReasons = [
    ...(quarantinedPayload.reasons || []),
    ...staleRefs.flatMap((ref) => provenanceRefReasons('stale_provenance_ref', ref)),
  ];

  return {
    ...normalized,
    reasons: unique([...normalized.reasons, ...runnerReasons]).sort(),
  };
}

function summarizeResolutionVerdicts(resolutions = []) {
  const counts = {
    supported: 0,
    contradicted: 0,
    conflicted: 0,
    insufficient_evidence: 0,
  };
  for (const resolution of resolutions) {
    const verdict = VERDICTS.has(resolution?.verdict) ? resolution.verdict : 'insufficient_evidence';
    counts[verdict] += 1;
  }
  return {
    conflictCount: resolutions.length,
    supportedCount: counts.supported,
    contradictedCount: counts.contradicted,
    conflictedCount: counts.conflicted,
    insufficientEvidenceCount: counts.insufficient_evidence,
  };
}

export async function buildProductionProvenanceResolutionReport({
  conflicts = [],
  provenancePassages,
  modelResolver,
  policy,
  runId = 'provenance-resolution-run',
  recordedAt = new Date().toISOString(),
} = {}) {
  const resolutions = [];
  for (const conflict of normalizeList(conflicts)) {
    const resolution = await runProvenanceResolutionAgents({
      conflict,
      provenancePassages,
      modelResolver,
      policy,
    });
    resolutions.push({
      ...resolution,
      promotionAllowed: false,
      modelEvidenceOnly: true,
      canPromote: false,
      authority: 'evidence_only',
    });
  }

  return {
    evidenceType: 'provenance_resolution_report',
    runId,
    recordedAt,
    summary: summarizeResolutionVerdicts(resolutions),
    resolutions,
    modelEvidenceOnly: true,
    promotionAllowed: false,
    promotionEvidenceOnly: true,
    evidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
  };
}
