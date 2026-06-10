export const CAPABILITY_GOAL_DEFINITIONS = Object.freeze([
  {
    goalId: 'benchmark_spine',
    label: 'Benchmark spine and longitudinal frontier',
    requiredEvidence: ['held_out_suite', 'repeated_cycle', 'frontier_trend', 'budget_accounting'],
  },
  {
    goalId: 'meta_harness_loop',
    label: 'Meta-Harness paper-grade loop',
    requiredEvidence: ['isolated_variant', 'source_artifact', 'trace_artifact', 'metric_artifact', 'proposer_context'],
  },
  {
    goalId: 'rho_at_scale',
    label: 'RHO at scale',
    requiredEvidence: ['embedding_diversity', 'grouped_reroll', 'candidate_family_delta', 'self_preference_signal'],
  },
  {
    goalId: 'memgraphrag_depth',
    label: 'MemGraphRAG production depth',
    requiredEvidence: ['role_pipeline', 'provenance_retrieval', 'conflict_adjudication', 'migration_record', 'eval_signal'],
  },
  {
    goalId: 'bes_full_lanes',
    label: 'BES full-lane semantics',
    requiredEvidence: ['forward_backward_fusion', 'dense_verifier', 'trajectory_provenance', 'family_recombination', 'champion_frontier'],
  },
  {
    goalId: 'multimodal_system_sense',
    label: 'Multimodal as a full system sense',
    requiredEvidence: ['visual_benchmark_case', 'visual_memory_node', 'visual_rho_case', 'visual_policy_gate', 'vlm_budget_route'],
  },
  {
    goalId: 'a2a_external_durability',
    label: 'A2A beyond local durability',
    requiredEvidence: ['endpoint_contract', 'persistent_queue', 'issuer_secret', 'peer_negotiation', 'multi_hop_lineage'],
  },
  {
    goalId: 'governance_autonomy',
    label: 'Governance and autonomy tuning',
    requiredEvidence: ['autonomy_level', 'approval_policy', 'escalation_policy', 'override_audit', 'rollback_drill'],
  },
]);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeGoalId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeEvidence(evidence = []) {
  return [...new Set(asArray(evidence)
    .map((item) => String(item || '').trim())
    .filter(Boolean))]
    .sort();
}

function normalizeDefinition(definition = {}) {
  return {
    goalId: normalizeGoalId(definition.goalId),
    label: definition.label || definition.goalId || 'Capability goal',
    requiredEvidence: normalizeEvidence(definition.requiredEvidence),
  };
}

function normalizeSignal(signal = {}) {
  return {
    goalId: normalizeGoalId(signal.goalId || signal.id),
    evidence: normalizeEvidence(signal.evidence || signal.evidenceTypes),
    blockers: normalizeEvidence(signal.blockers || signal.blockedReasons),
    notes: asArray(signal.notes).filter(Boolean),
    updatedAt: signal.updatedAt || null,
  };
}

function classifyGoal(definition, signal) {
  if (!signal) return 'missing';
  if (signal.blockers.length) return 'blocked';
  const required = definition.requiredEvidence;
  const coveredCount = required.filter((item) => signal.evidence.includes(item)).length;
  if (required.length > 0 && coveredCount === required.length) return 'implemented';
  if (signal.evidence.length > 0) return 'partial';
  return 'missing';
}

export function summarizeCapabilityGoalStatus({
  definitions = CAPABILITY_GOAL_DEFINITIONS,
  signals = [],
} = {}) {
  const normalizedDefinitions = asArray(definitions).map(normalizeDefinition).filter((entry) => entry.goalId);
  const signalByGoal = new Map(asArray(signals).map((signal) => {
    const normalized = normalizeSignal(signal);
    return [normalized.goalId, normalized];
  }).filter(([goalId]) => goalId));

  const goals = normalizedDefinitions.map((definition) => {
    const signal = signalByGoal.get(definition.goalId);
    const evidence = signal?.evidence || [];
    const missingEvidence = definition.requiredEvidence.filter((item) => !evidence.includes(item));
    const status = classifyGoal(definition, signal);
    return {
      ...definition,
      status,
      evidence,
      missingEvidence,
      blockers: signal?.blockers || [],
      notes: signal?.notes || [],
      updatedAt: signal?.updatedAt || null,
      authority: 'status_evidence_only',
      canPromote: false,
    };
  });

  const counts = goals.reduce((acc, goal) => {
    acc[goal.status] = (acc[goal.status] || 0) + 1;
    return acc;
  }, {
    implemented: 0,
    partial: 0,
    blocked: 0,
    missing: 0,
  });

  return {
    schemaVersion: 1,
    authority: 'status_evidence_only',
    canPromote: false,
    counts,
    totalCount: goals.length,
    implementedCount: counts.implemented,
    openCount: goals.length - counts.implemented,
    goals,
  };
}
