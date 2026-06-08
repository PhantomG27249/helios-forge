const DEFAULT_POLICY = {
  schemaThreshold: 3,
  conflictThreshold: 0.8,
  bridgingThreshold: 0.8,
  pendingTtl: 7,
  retrievalRestartProbability: 0.15,
  maxBridgeItems: 2,
  provenanceRequired: true,
};

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function coresetReasons(coreset = {}) {
  return normalizeList(coreset.items).flatMap((item) => normalizeList(item.reasons));
}

function candidateFrom(base, overrides, rationale) {
  return {
    ...base,
    ...overrides,
    status: 'shadow_only',
    provenanceRequired: true,
    rationale,
  };
}

export function proposeMemoryPolicies({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
} = {}) {
  const base = { ...DEFAULT_POLICY, ...baselinePolicy };
  const reasons = new Set(coresetReasons(coreset));
  const candidates = [];

  if (reasons.has('memgraph_pending_activation_stall') || reasons.has('memory_stale_decay_pressure')) {
    candidates.push(candidateFrom(base, {
      schemaThreshold: Math.max(1, Math.floor(base.schemaThreshold) - 1),
      pendingTtl: Math.max(1, Math.floor(base.pendingTtl) - 2),
      retrievalRestartProbability: clamp(base.retrievalRestartProbability + 0.05, 0.05, 0.5),
    }, ['pending_activation_stall']));
  }

  if (reasons.has('memgraph_logical_conflict') || reasons.has('memgraph_temporal_conflict')) {
    candidates.push(candidateFrom(base, {
      conflictThreshold: clamp(base.conflictThreshold - 0.1, 0.5, 0.95),
      retrievalRestartProbability: clamp(base.retrievalRestartProbability + 0.03, 0.05, 0.5),
    }, ['conflict_adjudication_pressure']));
  }

  if (reasons.has('memgraph_fragmentation') || reasons.has('memgraph_thematic_irrelevance')) {
    candidates.push(candidateFrom(base, {
      bridgingThreshold: clamp(base.bridgingThreshold - 0.08, 0.5, 0.95),
      maxBridgeItems: Math.max(0, Math.floor(base.maxBridgeItems) - 1),
      retrievalRestartProbability: clamp(base.retrievalRestartProbability + 0.04, 0.05, 0.5),
    }, ['fragmentation_bridge_tuning']));
  }

  if (reasons.has('memgraph_granularity_conflict')) {
    candidates.push(candidateFrom(base, {
      conflictThreshold: clamp(base.conflictThreshold - 0.06, 0.5, 0.95),
      bridgingThreshold: clamp(base.bridgingThreshold + 0.04, 0.5, 0.98),
    }, ['granularity_refinement_pressure']));
  }

  if (candidates.length === 0) {
    candidates.push(candidateFrom(base, {}, ['baseline_shadow_candidate']));
  }

  return candidates.slice(0, Math.max(0, Math.floor(maxCandidates)));
}

export function evaluateMemoryPolicyCandidate({ candidate = {}, memoryCase = {} } = {}) {
  const policy = { ...DEFAULT_POLICY, ...candidate };
  const caseReasons = new Set(normalizeList(memoryCase.reasons));
  const provenance = normalizeList(memoryCase.provenance || memoryCase.evidence);
  const reasons = [];

  if (policy.status !== 'shadow_only' && (policy.provenanceRequired === false || provenance.length === 0)) {
    return {
      score: 0,
      safetyStatus: 'blocked',
      reasons: ['provenance_required_for_memory_promotion'],
    };
  }

  let score = 0.2;
  if (caseReasons.has('memgraph_pending_activation_stall') && policy.schemaThreshold <= DEFAULT_POLICY.schemaThreshold) {
    score += 0.2;
    reasons.push('schema_threshold_addresses_activation_stall');
  }
  if (caseReasons.has('memgraph_pending_activation_stall') && policy.pendingTtl < DEFAULT_POLICY.pendingTtl) {
    score += 0.15;
    reasons.push('pending_ttl_addresses_activation_stall');
  }
  if ((caseReasons.has('memgraph_logical_conflict') || caseReasons.has('memgraph_temporal_conflict')) && policy.conflictThreshold < DEFAULT_POLICY.conflictThreshold) {
    score += 0.2;
    reasons.push('conflict_threshold_addresses_conflicts');
  }
  if (caseReasons.has('memgraph_fragmentation') && policy.bridgingThreshold < DEFAULT_POLICY.bridgingThreshold) {
    score += 0.15;
    reasons.push('bridging_threshold_addresses_fragmentation');
  }
  if ((caseReasons.has('memgraph_fragmentation') || caseReasons.has('memgraph_thematic_irrelevance')) && policy.maxBridgeItems < DEFAULT_POLICY.maxBridgeItems) {
    score += 0.15;
    reasons.push('bridge_cap_addresses_fragmentation_noise');
  }
  if (policy.retrievalRestartProbability > DEFAULT_POLICY.retrievalRestartProbability) {
    score += 0.05;
    reasons.push('retrieval_restart_exploration');
  }
  if (policy.provenanceRequired !== false) {
    reasons.push('provenance_required');
  }

  return {
    score: clamp(score, 0, 1),
    safetyStatus: 'shadow_only',
    reasons,
  };
}

