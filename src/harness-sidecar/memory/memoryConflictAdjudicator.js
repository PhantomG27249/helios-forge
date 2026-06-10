function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function relationFor(fact = {}) {
  return fact.relation || fact.predicate || '';
}

function passageIdsFor(fact = {}) {
  return normalizeList(fact.passageIds || fact.provenancePassageIds || fact.passageId).map(String).sort();
}

function confidenceFor(fact = {}) {
  const value = Number(fact.confidence ?? fact.sourceConfidence);
  return Number.isFinite(value) ? value : null;
}

function evidenceId(evidence) {
  if (!evidence) return null;
  if (typeof evidence === 'string') return evidence;
  if (typeof evidence === 'object') {
    return evidence.passageId || evidence.id || evidence.sourceId || evidence.traceId || null;
  }
  return String(evidence);
}

function evidenceText(evidence) {
  if (!evidence || typeof evidence !== 'object') return '';
  return String(evidence.text || evidence.summary || evidence.content || '');
}

function tokenSet(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 2);
}

function passageSupportsFact(evidence, fact = {}) {
  const text = evidenceText(evidence).toLowerCase();
  if (!text) return false;
  const id = evidenceId(evidence);
  const provenanceHit = id && passageIdsFor(fact).includes(id);
  const subjectTokens = tokenSet(fact.subject);
  const relationTokens = tokenSet(relationFor(fact));
  const objectTokens = tokenSet(fact.object);
  const subjectHit = subjectTokens.length === 0 || subjectTokens.some((token) => text.includes(token));
  const relationHit = relationTokens.length === 0 || relationTokens.some((token) => text.includes(token));
  const objectHit = objectTokens.length > 0 && objectTokens.every((token) => text.includes(token));
  if (provenanceHit && objectHit) return true;
  return subjectHit && relationHit && objectHit;
}

function supportSummary({ evidenceRecords = [], conflict = {} } = {}) {
  const existingSupport = evidenceRecords.filter((evidence) => passageSupportsFact(evidence, conflict.existingFact));
  const newSupport = evidenceRecords.filter((evidence) => passageSupportsFact(evidence, conflict.newFact));
  const supportedIds = new Set([
    ...evidenceRecords,
    ...existingSupport,
    ...newSupport,
  ].map(evidenceId).filter(Boolean));
  const requiredIds = conflictProvenance(conflict.existingFact, conflict.newFact);
  return {
    existingSupport,
    newSupport,
    supportedIds,
    requiredIds,
    evidenceCoverage: requiredIds.length === 0
      ? 0
      : Math.round((requiredIds.filter((id) => supportedIds.has(id)).length / requiredIds.length) * 100) / 100,
  };
}

function normalizeToken(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function decisionIdFor({ conflict = {}, action = 'needs_review' } = {}) {
  return [
    'memory_conflict_decision',
    normalizeToken(conflict.type),
    normalizeToken(action),
    normalizeToken(conflict.existingFact?.id || conflict.existingFact?.object),
    normalizeToken(conflict.newFact?.id || conflict.newFact?.object),
  ].join('_');
}

function normalizePolicy(policy = {}) {
  return {
    autoDiscardBelowConfidence: Number(policy.autoDiscardBelowConfidence ?? 0),
    requirePassageSupport: policy.requirePassageSupport === true,
  };
}

function evidenceSummaryFor(support = {}) {
  const requiredIds = normalizeList(support.requiredIds).map(String);
  const supportedValues = support.supportedIds instanceof Set
    ? [...support.supportedIds]
    : normalizeList(support.supportedIds);
  const supportedIds = new Set(supportedValues.map(String));
  return {
    requiredCount: requiredIds.length,
    coveredCount: requiredIds.filter((id) => supportedIds.has(id)).length,
    coverage: support.evidenceCoverage || 0,
  };
}

function temporalValue(fact = {}) {
  return fact.validFrom || fact.validTo || fact.observedAt || fact.timestamp || fact.time || null;
}

function sameClaimSlot(left = {}, right = {}) {
  return left.subject && right.subject && left.subject === right.subject && relationFor(left) === relationFor(right);
}

function conflictProvenance(existingFact = {}, newFact = {}) {
  return [...new Set([...passageIdsFor(existingFact), ...passageIdsFor(newFact)])].sort();
}

function classifyConflict(existingFact = {}, newFact = {}, similarityThreshold) {
  if (!sameClaimSlot(existingFact, newFact)) return null;
  const leftTime = temporalValue(existingFact);
  const rightTime = temporalValue(newFact);
  if (existingFact.object !== newFact.object) {
    if (leftTime || rightTime) return 'temporal';
    return 'mutually_exclusive';
  }
  if (
    existingFact.object === newFact.object
    && (existingFact.granularity || newFact.granularity)
    && existingFact.granularity !== newFact.granularity
  ) {
    return 'granularity';
  }
  if (existingFact.supersededBy || normalizeList(newFact.supersedes).includes(existingFact.id)) {
    return 'stale_or_superseded';
  }
  const leftConfidence = confidenceFor(existingFact);
  const rightConfidence = confidenceFor(newFact);
  if (
    leftConfidence !== null
    && rightConfidence !== null
    && Math.abs(leftConfidence - rightConfidence) >= (1 - similarityThreshold)
  ) {
    return 'source_confidence';
  }
  return null;
}

export function detectGlobalMemoryConflicts({
  layers,
  newFact,
  similarityThreshold = 0.8,
} = {}) {
  if (!layers || !newFact) return [];
  return normalizeList(layers.facts)
    .map((existingFact) => {
      const type = classifyConflict(existingFact, newFact, similarityThreshold);
      if (!type) return null;
      return {
        type,
        existingFact,
        newFact,
        factIds: [existingFact.id, newFact.id].filter(Boolean),
        provenanceIds: conflictProvenance(existingFact, newFact),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.type.localeCompare(right.type));
}

export function adjudicateMemoryConflict({ conflict, evidence = [], policy = {} } = {}) {
  if (!conflict) {
    return {
      action: 'needs_review',
      decisionId: decisionIdFor({ action: 'needs_review' }),
      policy: normalizePolicy(policy),
      reasons: ['missing_conflict'],
      provenanceIds: [],
      evidenceSummary: { requiredCount: 0, coveredCount: 0, coverage: 0 },
    };
  }
  const evidenceRecords = normalizeList(evidence);
  const evidenceIds = evidenceRecords.map(evidenceId).filter(Boolean);
  const provenanceIds = [...new Set([...evidenceIds, ...normalizeList(conflict.provenanceIds)])].map(String);
  const support = supportSummary({ evidenceRecords, conflict });
  const reasons = [`conflict:${conflict.type}`];
  const existingConfidence = confidenceFor(conflict.existingFact);
  const newConfidence = confidenceFor(conflict.newFact);
  const autoDiscardBelow = Number(policy.autoDiscardBelowConfidence ?? 0);
  const decision = (item) => ({
    ...item,
    decisionId: decisionIdFor({ conflict, action: item.action }),
    policy: normalizePolicy(policy),
    evidenceSummary: evidenceSummaryFor(support),
  });

  if (provenanceIds.length === 0) {
    return decision({ action: 'needs_review', conflict, reasons: [...reasons, 'missing_adjudication_evidence'], provenanceIds, evidenceCoverage: support.evidenceCoverage });
  }

  if (conflict.type === 'temporal') {
    return decision({ action: 'temporally_qualify', conflict, reasons, provenanceIds, evidenceCoverage: support.evidenceCoverage });
  }
  if (conflict.type === 'granularity') {
    return decision({ action: 'refine', conflict, reasons, provenanceIds, evidenceCoverage: support.evidenceCoverage });
  }
  if (conflict.type === 'stale_or_superseded') {
    return decision({ action: 'discard', targetFactId: conflict.existingFact?.id, conflict, reasons, provenanceIds, evidenceCoverage: support.evidenceCoverage });
  }
  if (conflict.type === 'source_confidence') {
    if (newConfidence !== null && newConfidence >= 0.9) {
      return decision({ action: 'keep_both', conflict, reasons: [...reasons, 'high_confidence_source'], provenanceIds, evidenceCoverage: support.evidenceCoverage });
    }
    return decision({ action: 'needs_review', conflict, reasons: [...reasons, 'source_confidence_uncertain'], provenanceIds, evidenceCoverage: support.evidenceCoverage });
  }
  if (conflict.type === 'mutually_exclusive') {
    if (policy.requirePassageSupport === true) {
      if (support.newSupport.length === 0) {
        return decision({
          action: 'needs_review',
          conflict,
          reasons: [...reasons, 'missing_required_passage_support'],
          provenanceIds,
          evidenceCoverage: support.evidenceCoverage,
        });
      }
      if (support.newSupport.length >= support.existingSupport.length) {
        return decision({
          action: 'discard',
          targetFactId: conflict.existingFact?.id,
          conflict,
          reasons: [...reasons, 'retrieved_passage_supports_new_fact'],
          provenanceIds,
          evidenceCoverage: support.evidenceCoverage,
        });
      }
    }
    if (existingConfidence !== null && existingConfidence < autoDiscardBelow) {
      return decision({ action: 'discard', targetFactId: conflict.existingFact?.id, conflict, reasons, provenanceIds, evidenceCoverage: support.evidenceCoverage });
    }
    if (newConfidence !== null && existingConfidence !== null && newConfidence > existingConfidence) {
      return decision({ action: 'discard', targetFactId: conflict.existingFact?.id, conflict, reasons, provenanceIds, evidenceCoverage: support.evidenceCoverage });
    }
    return decision({ action: 'needs_review', conflict, reasons: [...reasons, 'mutual_exclusion_uncertain'], provenanceIds, evidenceCoverage: support.evidenceCoverage });
  }
  return decision({ action: 'needs_review', conflict, reasons: [...reasons, 'unknown_conflict_type'], provenanceIds, evidenceCoverage: support.evidenceCoverage });
}

export function applyConflictDecision({ layers, decision } = {}) {
  if (!layers || !decision) return layers;
  const targetFactId = decision.targetFactId || decision.conflict?.existingFact?.id;
  if (decision.action === 'discard' && targetFactId) {
    const target = normalizeList(layers.facts).find((fact) => fact.id === targetFactId);
    if (target) {
      target.status = 'discarded';
      target.conflictDecision = {
        action: decision.action,
        reasons: normalizeList(decision.reasons),
        provenanceIds: normalizeList(decision.provenanceIds),
      };
    }
  }
  if (decision.action === 'temporally_qualify' && decision.conflict?.newFact) {
    decision.conflict.newFact.temporallyQualified = true;
  }
  if (decision.action === 'refine' && decision.conflict?.newFact) {
    decision.conflict.newFact.refinedPredicate = `${relationFor(decision.conflict.newFact)}:${decision.conflict.newFact.granularity || 'refined'}`;
  }
  return layers;
}
