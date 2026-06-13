import { sanitizeIcrEvidenceForDashboard } from '../icr/icrEvidence.js';

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
    goalId: 'icr_test_time_compute',
    label: 'ICR test-time compute evidence',
    requiredEvidence: [
      'icr_branch_trace_evidence',
      'icr_blind_judge_evidence',
      'icr_bes_lane_evidence',
      'icr_cost_gate',
      'icr_production_replay',
      'icr_rho_uplift_report',
      'icr_dashboard_snapshot',
    ],
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
    level4ReadyCandidate: signal.level4ReadyCandidate === true,
    persistedProductionEvidence: signal.persistedProductionEvidence === true,
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

function mergeSignals(signals = []) {
  const signalByGoal = new Map();
  for (const signal of asArray(signals)) {
    const normalized = normalizeSignal(signal);
    if (!normalized.goalId) continue;
    const previous = signalByGoal.get(normalized.goalId);
    signalByGoal.set(normalized.goalId, previous ? {
      goalId: normalized.goalId,
      evidence: normalizeEvidence([...previous.evidence, ...normalized.evidence]),
      productionEvidence: normalizeEvidence([...previous.productionEvidence, ...normalized.productionEvidence]),
      blockers: normalizeEvidence([...previous.blockers, ...normalized.blockers]),
      notes: [...previous.notes, ...normalized.notes],
      updatedAt: normalized.updatedAt || previous.updatedAt,
      level4ReadyCandidate: previous.level4ReadyCandidate || normalized.level4ReadyCandidate,
      persistedProductionEvidence: previous.persistedProductionEvidence || normalized.persistedProductionEvidence,
    } : normalized);
  }
  return signalByGoal;
}

function hasBranchTraceEvidence(record = {}, dashboardRow = {}) {
  if (dashboardRow.branchCount > 0 || dashboardRow.branchIds?.length > 0) return true;
  return asArray(record.branches ?? record.branchTraces ?? record.traces)
    .some((branch) => branch?.kind === 'icr_branch_trace' || branch?.branchId || branch?.id);
}

function hasBlindJudgeEvidence(record = {}, dashboardRow = {}) {
  const packet = record.finalJudgePacket ?? record.blindJudgePacket ?? record.final_judge_packet;
  if (packet?.kind === 'icr_blind_final_judge_packet' && asArray(packet.candidates).length > 0) return true;
  if (asArray(packet?.candidates).length > 0) return true;
  return Boolean(dashboardRow.finalCandidateId);
}

function hasBesLaneEvidence(record = {}) {
  return Boolean(record.besLaneEvidence
    || record.besLaneResult
    || record.besFusionEvidence
    || record.artifacts?.besLaneEvidence
    || asArray(record.artifacts).some((artifact) => artifact?.type === 'bes_lane_evidence' || artifact?.lane === 'icr'));
}

const REQUIRED_ICR_RHO_METRICS = Object.freeze([
  'repeated_sampling_baseline',
  'static_council_baseline',
  'icr_branch_family',
  'icr_bes_lane_fusion',
]);

function hasCompleteIcrRhoUpliftMetrics(report = {}) {
  const metrics = report.upliftMetrics ?? report.metricsByLabel ?? {};
  if (!REQUIRED_ICR_RHO_METRICS.every((label) => metrics[label])) return false;
  return ['icr_branch_family', 'icr_bes_lane_fusion'].every((label) => {
    const entry = metrics[label];
    return entry?.beatsBestSingle === true
      && Number(entry.scoreDelta ?? 0) > 0
      && asArray(entry.cheaperBaselineLosses).length === 0;
  });
}

function hasRhoUpliftReport(record = {}) {
  const report = record.rhoUpliftReport
    || record.rhoReplayComparison
    || record.rhoReplayReport
    || record.upliftReport
    || record.artifacts?.rhoUpliftReport
    || asArray(record.artifacts).find((artifact) => artifact?.type === 'rho_uplift_report');
  if (!report || typeof report !== 'object') return false;
  const regressions = asArray(report.regressions);
  if (regressions.length > 0) return false;
  return hasCompleteIcrRhoUpliftMetrics(report);
}

function hasRhoRegression(record = {}) {
  const report = record.rhoUpliftReport
    || record.rhoReplayComparison
    || record.rhoReplayReport
    || record.upliftReport
    || record.artifacts?.rhoUpliftReport
    || asArray(record.artifacts).find((artifact) => artifact?.type === 'rho_uplift_report');
  if (!report || typeof report !== 'object') return false;
  if (asArray(report.regressions).length > 0) return true;
  if (report.upliftOverBaselines === false || report.heldoutUpliftProven === false) return true;
  const metrics = [report.upliftMetrics?.icr_branch_family, report.upliftMetrics?.icr_bes_lane_fusion]
    .filter(Boolean);
  return metrics.some((entry) => (
    entry.beatsBestSingle === false
      || asArray(entry.cheaperBaselineLosses).length > 0
      || Number(entry.scoreDelta ?? 0) < 0
  ));
}

function hasProductionReplayEvidence(record = {}) {
  const productionReplay = record.productionReplay
    ?? record.productionReplayEvidence
    ?? record.persistedProductionEvidence
    ?? record.artifacts?.productionReplay;
  if (productionReplay === true) return true;
  if (productionReplay && typeof productionReplay === 'object') {
    return productionReplay.persisted === true || productionReplay.persistedProductionEvidence === true;
  }
  return asArray(record.artifacts).some((artifact) => (
    artifact?.type === 'production_replay'
      && (artifact.persisted === true || artifact.persistedProductionEvidence === true)
  ));
}

function deriveIcrCapabilitySignal(records = [], config = {}) {
  const dashboardRows = asArray(records)
    .filter((record) => record && typeof record === 'object')
    .map((record) => sanitizeIcrEvidenceForDashboard(record, config));

  if (dashboardRows.length === 0) {
    return { signal: null, dashboardRows };
  }

  const evidence = new Set(['icr_dashboard_snapshot']);
  const blockers = new Set();
  let productionReady = false;

  for (const [index, record] of asArray(records).entries()) {
    if (!record || typeof record !== 'object') continue;
    const dashboardRow = dashboardRows[index] || {};

    if (hasBranchTraceEvidence(record, dashboardRow)) {
      evidence.add('icr_branch_trace_evidence');
    } else {
      blockers.add('missing_icr_branch_trace_evidence');
    }

    if (hasBlindJudgeEvidence(record, dashboardRow)) {
      evidence.add('icr_blind_judge_evidence');
    } else {
      blockers.add('missing_icr_blind_judge_evidence');
    }

    if (hasBesLaneEvidence(record)) evidence.add('icr_bes_lane_evidence');

    if (hasRhoUpliftReport(record)) {
      evidence.add('icr_rho_uplift_report');
    } else {
      blockers.add('missing_icr_rho_uplift_report');
      if (hasRhoRegression(record)) blockers.add('icr_rho_regression_detected');
    }

    if (dashboardRow.costGateStatus === 'within_limit') {
      evidence.add('icr_cost_gate');
    } else {
      blockers.add('icr_cost_gate_unproven');
    }

    if (dashboardRow.contextOverflowRisk === true) blockers.add('icr_context_overflow_risk');

    if (hasProductionReplayEvidence(record)) {
      evidence.add('icr_production_replay');
      productionReady = true;
    } else {
      blockers.add('icr_production_replay_missing');
    }
  }

  return {
    dashboardRows,
    signal: {
      goalId: 'icr_test_time_compute',
      evidence: [...evidence],
      blockers: [...blockers],
      level4ReadyCandidate: productionReady && blockers.size === 0,
      persistedProductionEvidence: productionReady,
    },
  };
}

export function summarizeCapabilityGoalStatus({
  definitions = CAPABILITY_GOAL_DEFINITIONS,
  signals = [],
  icrEvidence = [],
  icrConfig = {},
} = {}) {
  const normalizedDefinitions = asArray(definitions).map(normalizeDefinition).filter((entry) => entry.goalId);
  const { signal: icrSignal, dashboardRows: icrDashboardRows } = deriveIcrCapabilitySignal(icrEvidence, icrConfig);
  const signalByGoal = mergeSignals(icrSignal ? [...asArray(signals), icrSignal] : signals);

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
      level4Proven: false,
      authority: 'status_evidence_only',
      canPromote: false,
      level4ReadyCandidate: definition.goalId === 'icr_test_time_compute'
        ? signal?.level4ReadyCandidate === true
          && signal?.persistedProductionEvidence === true
          && missingEvidence.length === 0
          && (signal?.blockers || []).length === 0
        : level4ReadyCandidate,
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
    icrDashboardRows,
  };
}
