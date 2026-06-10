const LANE_CONTRACTS = Object.freeze({
  code: Object.freeze({
    lane: 'code',
    candidateUnit: 'patch_policy',
    verifierUnit: 'test_eval',
    artifacts: Object.freeze(['patch', 'tests', 'diff']),
  }),
  verifier: Object.freeze({
    lane: 'verifier',
    candidateUnit: 'verifier_policy',
    verifierUnit: 'verifier_eval',
    artifacts: Object.freeze(['rubric', 'thresholds', 'case_set']),
  }),
  memory: Object.freeze({
    lane: 'memory',
    candidateUnit: 'graph_policy',
    verifierUnit: 'memory_eval',
    artifacts: Object.freeze(['graph_delta', 'retrieval_trace', 'promotion_record']),
  }),
  research: Object.freeze({
    lane: 'research',
    candidateUnit: 'research_plan',
    verifierUnit: 'evidence_eval',
    artifacts: Object.freeze(['claim_set', 'source_set', 'synthesis']),
  }),
  skill: Object.freeze({
    lane: 'skill',
    candidateUnit: 'skill_policy',
    verifierUnit: 'skill_eval',
    artifacts: Object.freeze(['skill_spec', 'examples', 'verification_trace']),
  }),
  swarm: Object.freeze({
    lane: 'swarm',
    candidateUnit: 'swarm_policy',
    verifierUnit: 'swarm_eval',
    artifacts: Object.freeze(['agent_roles', 'handoff_contracts', 'coordination_trace']),
  }),
  context: Object.freeze({
    lane: 'context',
    candidateUnit: 'context_policy',
    verifierUnit: 'context_eval',
    artifacts: Object.freeze(['context_profile', 'retrieval_weights', 'token_budget']),
  }),
  compaction: Object.freeze({
    lane: 'compaction',
    candidateUnit: 'compaction_policy',
    verifierUnit: 'compaction_eval',
    artifacts: Object.freeze(['compaction_profile', 'continuation_trace', 'retention_budget']),
  }),
  tool: Object.freeze({
    lane: 'tool',
    candidateUnit: 'tool_loop_policy',
    verifierUnit: 'tool_loop_eval',
    artifacts: Object.freeze(['tool_sequence', 'recovery_policy', 'approval_contract']),
  }),
  budget: Object.freeze({
    lane: 'budget',
    candidateUnit: 'budget_policy',
    verifierUnit: 'budget_eval',
    artifacts: Object.freeze(['budget_profile', 'allocator_trace', 'cost_gate']),
  }),
  visual: Object.freeze({
    lane: 'visual',
    candidateUnit: 'visual_policy',
    verifierUnit: 'visual_eval',
    artifacts: Object.freeze(['visual_rubric', 'artifact_capture_policy', 'vlm_thresholds']),
  }),
  mcp_trust: Object.freeze({
    lane: 'mcp_trust',
    candidateUnit: 'mcp_trust_policy',
    verifierUnit: 'mcp_trust_eval',
    artifacts: Object.freeze(['capability_scope', 'poisoning_policy', 'trust_decision']),
  }),
  harness: Object.freeze({
    lane: 'harness',
    candidateUnit: 'harness_configuration',
    verifierUnit: 'harness_experiment_eval',
    artifacts: Object.freeze(['routing_policy', 'coordination_policy', 'frontier_record']),
  }),
});

export function getBesLaneContract(lane) {
  const key = String(lane ?? '').trim().toLowerCase();
  const contract = LANE_CONTRACTS[key];
  if (!contract) {
    throw new Error(`Unknown BES lane: ${lane}`);
  }
  return {
    ...contract,
    artifacts: [...contract.artifacts],
  };
}

export function listBesLaneContracts() {
  return Object.keys(LANE_CONTRACTS)
    .sort()
    .map(getBesLaneContract);
}
