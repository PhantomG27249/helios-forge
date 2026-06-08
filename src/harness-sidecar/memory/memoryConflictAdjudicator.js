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
    return { action: 'needs_review', reasons: ['missing_conflict'], provenanceIds: [] };
  }
  const provenanceIds = [...new Set([...normalizeList(evidence), ...normalizeList(conflict.provenanceIds)])].map(String);
  const reasons = [`conflict:${conflict.type}`];
  const existingConfidence = confidenceFor(conflict.existingFact);
  const newConfidence = confidenceFor(conflict.newFact);
  const autoDiscardBelow = Number(policy.autoDiscardBelowConfidence ?? 0);

  if (provenanceIds.length === 0) {
    return { action: 'needs_review', conflict, reasons: [...reasons, 'missing_adjudication_evidence'], provenanceIds };
  }

  if (conflict.type === 'temporal') {
    return { action: 'temporally_qualify', conflict, reasons, provenanceIds };
  }
  if (conflict.type === 'granularity') {
    return { action: 'refine', conflict, reasons, provenanceIds };
  }
  if (conflict.type === 'stale_or_superseded') {
    return { action: 'discard', targetFactId: conflict.existingFact?.id, conflict, reasons, provenanceIds };
  }
  if (conflict.type === 'source_confidence') {
    if (newConfidence !== null && newConfidence >= 0.9) {
      return { action: 'keep_both', conflict, reasons: [...reasons, 'high_confidence_source'], provenanceIds };
    }
    return { action: 'needs_review', conflict, reasons: [...reasons, 'source_confidence_uncertain'], provenanceIds };
  }
  if (conflict.type === 'mutually_exclusive') {
    if (existingConfidence !== null && existingConfidence < autoDiscardBelow) {
      return { action: 'discard', targetFactId: conflict.existingFact?.id, conflict, reasons, provenanceIds };
    }
    if (newConfidence !== null && existingConfidence !== null && newConfidence > existingConfidence) {
      return { action: 'discard', targetFactId: conflict.existingFact?.id, conflict, reasons, provenanceIds };
    }
    return { action: 'needs_review', conflict, reasons: [...reasons, 'mutual_exclusion_uncertain'], provenanceIds };
  }
  return { action: 'needs_review', conflict, reasons: [...reasons, 'unknown_conflict_type'], provenanceIds };
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
