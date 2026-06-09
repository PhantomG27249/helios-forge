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
