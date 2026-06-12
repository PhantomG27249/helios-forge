export const CAPABILITY_GOAL_DEFINITIONS = Object.freeze([
  {
    goalId: 'benchmark_spine',
    label: 'Benchmark spine and longitudinal frontier',
    requiredEvidence: ['held_out_suite', 'repeated_cycle', 'frontier_trend', 'budget_accounting'],
    maturityStage: 'production_gated',
    productionGate: 'operatorDashboards',
    productionEvidenceRequired: ['persisted_replay_report', 'operator_dashboard_snapshot', 'frontier_dashboard_snapshot'],
    paperGradeAutonomyGaps: [],
  },
  {
    goalId: 'meta_harness_loop',
    label: 'Meta-Harness paper-grade loop',
    requiredEvidence: ['isolated_variant', 'source_artifact', 'trace_artifact', 'metric_artifact', 'proposer_context'],
    maturityStage: 'production_gated',
    productionGate: 'sourceTreeVariants',
    productionEvidenceRequired: ['persisted_campaign_report', 'frontier_dashboard_snapshot'],
    paperGradeAutonomyGaps: ['many_source_variant_campaigns', 'repeated_autonomous_campaign_evidence'],
  },
  {
    goalId: 'rho_at_scale',
    label: 'RHO at scale',
    requiredEvidence: ['embedding_diversity', 'grouped_reroll', 'candidate_family_delta', 'self_preference_signal'],
    maturityStage: 'production_gated',
    productionGate: 'modelBackedRhoEmbeddings',
    productionEvidenceRequired: ['production_grouped_reroll_report', 'longitudinal_improvement_trend'],
    paperGradeAutonomyGaps: ['production_grouped_rerolls', 'model_backed_embedding_scale'],
  },
  {
    goalId: 'memgraphrag_depth',
    label: 'MemGraphRAG production depth',
    requiredEvidence: ['role_pipeline', 'provenance_retrieval', 'conflict_adjudication', 'migration_record', 'eval_signal'],
    maturityStage: 'production_gated',
    productionGate: 'modelAssistedMemory',
    productionEvidenceRequired: ['memory_eval_dashboard', 'provenance_resolution_report'],
    paperGradeAutonomyGaps: ['production_resolution_agents', 'model_assisted_extraction_society'],
  },
  {
    goalId: 'bes_full_lanes',
    label: 'BES full-lane semantics',
    requiredEvidence: ['forward_backward_fusion', 'dense_verifier', 'trajectory_provenance', 'family_recombination', 'champion_frontier'],
    maturityStage: 'production_gated',
    productionGate: 'modelAssistedBesJudgment',
    productionEvidenceRequired: ['live_lane_report', 'dense_judgment_report'],
    paperGradeAutonomyGaps: ['production_live_lane_cycles', 'learned_dense_judgment'],
  },
  {
    goalId: 'multimodal_system_sense',
    label: 'Multimodal as a full system sense',
    requiredEvidence: ['visual_benchmark_case', 'visual_memory_node', 'visual_rho_case', 'visual_policy_gate', 'vlm_budget_route'],
    maturityStage: 'production_gated',
    productionGate: 'visualReplaySuites',
    productionEvidenceRequired: ['visual_replay_report', 'visual_frontier_snapshot'],
    paperGradeAutonomyGaps: ['production_visual_replay_frontier', 'visual_swarmcell_cycles'],
  },
  {
    goalId: 'a2a_external_durability',
    label: 'A2A beyond local durability',
    requiredEvidence: ['endpoint_contract', 'persistent_queue', 'issuer_secret', 'peer_negotiation', 'multi_hop_lineage'],
    maturityStage: 'production_gated',
    productionGate: 'productionA2aTransport',
    productionEvidenceRequired: ['external_peer_status', 'durable_queue_snapshot'],
    paperGradeAutonomyGaps: ['long_lived_external_peers', 'production_queue_backend'],
  },
  {
    goalId: 'governance_autonomy',
    label: 'Governance and autonomy tuning',
    requiredEvidence: ['autonomy_level', 'approval_policy', 'escalation_policy', 'override_audit', 'rollback_drill'],
    maturityStage: 'production_gated',
    productionGate: 'productionAutonomyPolicy',
    productionEvidenceRequired: ['autonomy_dashboard_snapshot', 'rollback_drill_report'],
    paperGradeAutonomyGaps: ['repeated_autonomy_dashboard_evidence', 'human_reviewed_escalation_history'],
  },
  {
    goalId: 'soul_coverage',
    label: 'Soul coverage and advisory evidence',
    requiredEvidence: ['soul_records', 'runtime_store', 'prompt_adapter'],
    maturityStage: 'implemented_substrate',
    productionGate: null,
    productionEvidenceRequired: [],
    paperGradeAutonomyGaps: ['nested_execution_not_implemented'],
  },
  {
    goalId: 'oversoul_coverage',
    label: 'Oversoul advisory runtime coverage',
    requiredEvidence: ['oversoul_contract', 'role_ecology', 'strategy_posture', 'governance_posture'],
    maturityStage: 'implemented_substrate',
    productionGate: null,
    productionEvidenceRequired: [],
    paperGradeAutonomyGaps: ['nested_execution_not_implemented'],
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
    maturityStage: definition.maturityStage || 'production_gated',
    productionGate: definition.productionGate || null,
    productionEvidenceRequired: normalizeEvidence(definition.productionEvidenceRequired),
    paperGradeAutonomyGaps: normalizeEvidence(definition.paperGradeAutonomyGaps),
  };
}

function normalizeSignal(signal = {}) {
  return {
    goalId: normalizeGoalId(signal.goalId || signal.id),
    evidence: normalizeEvidence(signal.evidence || signal.evidenceTypes),
    productionEvidence: normalizeEvidence(signal.productionEvidence || signal.productionEvidenceTypes),
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
    const productionEvidence = signal?.productionEvidence || [];
    const missingEvidence = definition.requiredEvidence.filter((item) => !evidence.includes(item));
    const missingProductionEvidence = definition.productionEvidenceRequired.filter((item) => !productionEvidence.includes(item));
    const status = classifyGoal(definition, signal);
    const hasProductionEvidenceRequirement = definition.productionEvidenceRequired.length > 0;
    const productionEvidenceComplete = hasProductionEvidenceRequirement && missingProductionEvidence.length === 0;
    const hasFuturePaperGaps = definition.paperGradeAutonomyGaps.length > 0;
    const maturityStage = status === 'implemented' && productionEvidenceComplete && !hasFuturePaperGaps
      ? 'production_evidence_available'
      : definition.maturityStage;
    const level4ReadyCandidate = status === 'implemented'
      && maturityStage === 'production_evidence_available'
      && productionEvidenceComplete
      && !hasFuturePaperGaps;
    return {
      ...definition,
      maturityStage,
      status,
      evidence,
      missingEvidence,
      productionEvidence,
      missingProductionEvidence,
      blockers: signal?.blockers || [],
      notes: signal?.notes || [],
      updatedAt: signal?.updatedAt || null,
      level4ReadyCandidate,
      level4Proven: false,
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
