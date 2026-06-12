import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeLaneEvidence } from '../src/harness-sidecar/bes/laneEvidence.js';
import { runBesLaneRuntime, runBesLaneRuntimeWithEvents } from '../src/harness-sidecar/bes/laneRuntime.js';

test('wraps a shadow candidate in a BES lane envelope', async () => {
  const result = await runBesLaneRuntime({
    lane: 'memory',
    taskId: 'task-memory-1',
    candidates: [
      {
        candidateId: 'memory_policy_1',
        status: 'shadow_only',
        rationale: ['pending_activation_stall'],
      },
    ],
    hardCases: [
      { caseId: 'case-1', reasons: ['memgraph_pending_activation_stall'] },
    ],
    denseSubgoals: [
      { id: 'activation_stall', requiredEvidence: 'schema threshold' },
    ],
    evaluator: ({ candidate }) => ({
      score: 0.7,
      reasons: ['schema threshold addresses activation stall'],
      safetyStatus: candidate.status,
    }),
  });

  assert.equal(result.lane, 'memory');
  assert.equal(result.taskId, 'task-memory-1');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].status, 'shadow_only');
  assert.equal(result.candidates[0].promotion.allowed, false);
  assert.ok(result.candidates[0].promotion.blockedReasons.includes('evidence_only_lane'));
  assert.equal(result.candidates[0].bes.denseSubgoals.score, 1);
  assert.equal(result.candidates[0].evidence.domain.score, 0.7);
  assert.equal(result.candidates[0].lineage.candidateId, 'memory_policy_1');
});

test('blocks candidates that claim durable approval or application', async () => {
  const result = await runBesLaneRuntime({
    lane: 'skill',
    taskId: 'task-skill-1',
    candidates: [
      {
        candidateId: 'skill_bad',
        status: 'approved',
        applied: true,
        durableApplyApproved: true,
        promotion: { allowed: true },
      },
    ],
    evaluator: () => ({ score: 1, reasons: ['looks useful'] }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.promotion.allowed, false);
  assert.ok(candidate.promotion.blockedReasons.includes('candidate_claims_approval'));
  assert.ok(candidate.promotion.blockedReasons.includes('candidate_claims_applied'));
  assert.ok(candidate.promotion.blockedReasons.includes('candidate_claims_promotion'));
});

test('preserves A2A and memory graph references without granting promotion authority', async () => {
  const result = await runBesLaneRuntime({
    lane: 'research',
    taskId: 'task-nested-mesh',
    a2aEnvelope: {
      payload: {
        candidateRef: 'candidate-1',
        rhoCaseIds: ['rho-case-1'],
        memoryGraphRefs: ['memory-fact-1'],
        lineage: { parents: ['agent-1', 'agent-2'] },
        trust: { external: false, verified: false },
        requiredVerification: ['citation_audit'],
      },
    },
    memoryGraphContext: {
      local: { nodeIds: ['local-hard-case-1'] },
      swarmCell: { nodeIds: ['cell-lesson-1'] },
      global: { nodeIds: ['global-pattern-1'], provenance: ['trace-1'] },
      conflicts: [{ id: 'conflict-1', status: 'needs_review' }],
    },
    candidates: [{ candidateId: 'candidate-1', status: 'shadow_only' }],
    hardCases: [{ caseId: 'rho-case-1', reasons: ['citation_gap'] }],
    evaluator: () => ({
      score: 0.75,
      reasons: ['citation gap addressed'],
      safetyStatus: 'shadow_only',
    }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.promotion.allowed, false);
  assert.equal(candidate.a2a.payload.candidateRef, 'candidate-1');
  assert.deepEqual(candidate.memoryGraph.global.nodeIds, ['global-pattern-1']);
  assert.deepEqual(candidate.memoryGraph.conflicts[0].id, 'conflict-1');
  assert.ok(candidate.lineage.lineageId.includes('candidate-1'));
});

test('failed RHO validation is visible and blocks promotion', async () => {
  const result = await runBesLaneRuntime({
    lane: 'code',
    taskId: 'task-rho-1',
    candidates: [{ candidateId: 'candidate-regression', status: 'shadow_only' }],
    replayRunner: async () => ({
      validation: { passed: false, reasons: ['regression_detected'] },
      preference: { winner: 'candidate' },
    }),
    evaluator: () => ({ score: 0.9, reasons: ['candidate preferred'] }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.evidence.rho.validation.passed, false);
  assert.ok(candidate.promotion.blockedReasons.includes('rho_validation_failed'));
  assert.equal(candidate.promotion.allowed, false);
});

test('failed replays and rejected candidates become future hard cases', async () => {
  const result = await runBesLaneRuntime({
    lane: 'code',
    taskId: 'task-hard-case-carry-forward',
    candidates: [
      { candidateId: 'candidate-replay-failed', status: 'shadow_only' },
      { candidateId: 'candidate-rejected', status: 'approved', durableApplyApproved: true },
    ],
    replayRunner: async ({ candidate }) => (
      candidate.candidateId === 'candidate-replay-failed'
        ? { validation: { passed: false, reasons: ['regression_on_trace_17'] } }
        : { validation: { passed: true } }
    ),
    evaluator: () => ({ score: 0.9, reasons: ['candidate looked promising'] }),
  });

  assert.deepEqual(result.futureHardCases.map((hardCase) => hardCase.caseId), [
    'task-hard-case-carry-forward:code:candidate-replay-failed:replay',
    'task-hard-case-carry-forward:code:candidate-rejected:rejection',
  ]);
  assert.equal(result.futureHardCases[0].source, 'rho_replay_failed');
  assert.deepEqual(result.futureHardCases[0].reasons, ['regression_on_trace_17']);
  assert.equal(result.futureHardCases[1].source, 'promotion_rejected');
  assert.ok(result.futureHardCases[1].reasons.includes('candidate_claims_approval'));
});

test('empty dense subgoal shells do not satisfy required evidence', async () => {
  const result = await runBesLaneRuntime({
    lane: 'harness',
    taskId: 'task-no-evidence',
    candidates: [{ candidateId: 'harness-candidate', status: 'shadow_only' }],
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.evidence.hasRequiredEvidence, false);
  assert.deepEqual(candidate.evidence.sources, []);
  assert.ok(candidate.promotion.blockedReasons.includes('missing_required_evidence'));
});

test('normalizes lane evidence sources and required evidence summary', () => {
  const evidence = normalizeLaneEvidence({
    domain: { score: 0.5 },
    rho: { validation: { passed: true } },
    denseSubgoals: { score: 1, total: 1, satisfiedSubgoalIds: ['goal'] },
  });

  assert.deepEqual(evidence.sources.sort(), ['dense_subgoals', 'domain_eval', 'rho_replay']);
  assert.equal(evidence.hasRequiredEvidence, true);
});

test('preserves sanitized model-router evidence in BES lane envelopes', async () => {
  const result = await runBesLaneRuntime({
    lane: 'code',
    taskId: 'task-model-router-evidence',
    candidates: [
      {
        candidateId: 'candidate_model_router',
        status: 'shadow_only',
        modelRouter: {
          authority: 'evidence_only',
          canPromote: true,
          decisionIds: ['model_choice_1'],
          rewardUpdateIds: ['reward_1'],
          posterior: {
            key: 'reviewer:code:model_choice',
            arms: {
              critic: { alpha: 6, beta: 2, observations: 7 },
            },
          },
          passKEvalRefs: ['passk_eval_1'],
          prompt: 'must-not-cross',
          rawOutput: 'never-return-this',
          headers: { Authorization: 'Bearer raw-secret-value' },
          credentials: { apiKey: 'raw-secret-value' },
        },
      },
    ],
    evaluator: () => ({ score: 0.81, reasons: ['router evidence reviewed'] }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.evidence.sources.includes('model_router'), true);
  assert.equal(candidate.modelRouter.authority, 'evidence_only');
  assert.equal(candidate.modelRouter.canPromote, false);
  assert.deepEqual(candidate.modelRouter.decisionIds, ['model_choice_1']);
  assert.equal(candidate.modelRouter.posterior.arms.critic.observations, 7);

  const serialized = JSON.stringify(candidate.modelRouter);
  assert.equal(serialized.includes('must-not-cross'), false);
  assert.equal(serialized.includes('never-return-this'), false);
  assert.equal(serialized.includes('raw-secret-value'), false);
  assert.equal(serialized.includes('Authorization'), false);
});

test('visual lane evidence is first-class and carries artifact-backed memory nodes', async () => {
  const visualEvidence = {
    nodes: [
      {
        id: 'visual_evidence:task_visual:screenshot',
        type: 'visual_evidence',
        artifactType: 'screenshot',
        path: '.harness/visual/task_visual/web-preview.png',
        passed: true,
      },
    ],
    artifacts: [{ type: 'screenshot', path: '.harness/visual/task_visual/web-preview.png' }],
    verdict: { passed: true, score: 0.88, confidence: 0.81 },
  };

  const evidence = normalizeLaneEvidence({ visualEvidence });
  assert.equal(evidence.sources.includes('visual_evidence'), true);
  assert.equal(evidence.summary.visualEvidenceCount, 1);
  assert.equal(evidence.summary.visualArtifactCount, 1);
  assert.equal(evidence.summary.visualEvidencePassed, true);

  const result = await runBesLaneRuntime({
    lane: 'visual',
    taskId: 'task_visual',
    candidates: [{ candidateId: 'visual_policy_candidate', status: 'shadow_only', visualEvidence }],
  });

  assert.equal(result.candidates[0].evidence.sources.includes('visual_evidence'), true);
  assert.deepEqual(result.candidates[0].visualEvidence.nodes.map((node) => node.type), ['visual_evidence']);
  assert.equal(result.candidates[0].memoryGraph.nodeIds[0], 'visual_evidence:task_visual:screenshot');
});

test('emits BES lane lifecycle events around runtime execution', async () => {
  const events = [];

  const result = await runBesLaneRuntimeWithEvents({
    lane: 'harness',
    taskId: 'task-lifecycle',
    candidates: [{ candidateId: 'harness_candidate_1', evidence: ['runtime wiring'] }],
    evaluator: () => ({ score: 0.8, reasons: ['runtime wiring covered'] }),
    emitEvent: async (event) => events.push(event),
  });

  assert.equal(result.candidateCount, 1);
  assert.deepEqual(events.map((event) => event.type), ['bes_lane.started', 'bes_lane.completed']);
  assert.equal(events[0].lane, 'harness');
  assert.equal(events[0].taskId, 'task-lifecycle');
  assert.equal(events[1].candidateCount, 1);
  assert.equal(events[1].bestCandidateId, 'harness_candidate_1');
  assert.deepEqual(events[1].evidenceSources, ['domain_eval']);
});

test('attaches lane-specific dense verifier units and trajectory provenance', async () => {
  const result = await runBesLaneRuntime({
    lane: 'code',
    taskId: 'task-code-provenance',
    candidates: [
      {
        candidateId: 'code_candidate_1',
        parents: ['seed_a'],
        trajectory: {
          operator: 'crossover',
          donorCandidateId: 'seed_b',
          trajectory: ['read', 'patch', 'npm test'],
        },
      },
    ],
    denseSubgoals: [
      { id: 'code-tests', lane: 'code', requiredEvidence: 'npm test' },
      { id: 'memory-promotion', lane: 'memory', requiredEvidence: 'graph delta' },
    ],
    evaluator: () => ({ score: 0.8, reasons: ['npm test passed for patch trajectory'] }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.bes.fusion.forward.candidateUnit, 'patch_policy');
  assert.equal(candidate.bes.fusion.backward.verifierUnit, 'test_eval');
  assert.equal(candidate.bes.fusion.evidenceOnly, true);
  assert.equal(candidate.bes.fusion.promotionAuthority, false);
  assert.equal(candidate.bes.denseSubgoals.total, 1);
  assert.equal(candidate.bes.denseSubgoals.verifierUnit, 'test_eval');
  assert.equal(candidate.bes.denseSubgoals.contract.lane, 'code');
  assert.equal(candidate.bes.denseSubgoals.contract.verifierUnit, 'test_eval');
  assert.deepEqual(candidate.bes.denseSubgoals.satisfiedSubgoalIds, ['code-tests']);
  assert.deepEqual(candidate.bes.denseSubgoals.verifierUnits, [
    {
      lane: 'code',
      verifierUnit: 'test_eval',
      subgoalIds: ['code-tests'],
      satisfiedSubgoalIds: ['code-tests'],
      missingSubgoalIds: [],
    },
  ]);
  assert.equal(candidate.bes.trajectoryOperators[0].operator, 'crossover');
  assert.equal(candidate.bes.trajectoryOperators[0].source, 'candidate.trajectory');
  assert.equal(candidate.bes.trajectoryOperators[0].operatorFamily, 'recombination');
  assert.equal(candidate.bes.trajectoryOperators[0].compatibleFamily, 'code');
  assert.deepEqual(candidate.bes.trajectoryOperators[0].parents, ['seed_a', 'seed_b']);
  assert.deepEqual(candidate.bes.fusion.live.trajectoryOperators[0].parents, ['seed_a', 'seed_b']);
  assert.equal(candidate.bes.fusion.live.trajectoryOperators[0].operatorFamily, 'recombination');
  assert.equal(candidate.evidence.sources.includes('trajectory_operator'), true);
  assert.ok(candidate.promotion.blockedReasons.includes('missing_external_policy_evidence'));
});

test('bridges champion archive records to frontier evidence without promotion authority', async () => {
  const result = await runBesLaneRuntime({
    lane: 'harness',
    taskId: 'task-frontier-bridge',
    candidates: [{ candidateId: 'champion_candidate', status: 'shadow_only' }],
    championArchive: {
      champions: [
        {
          attemptId: 'champion_candidate',
          score: 0.91,
          metadata: { compatibleFamily: 'harness-routing' },
        },
      ],
    },
    frontier: {
      records: [
        { frontierId: 'frontier_1', candidateId: 'champion_candidate', score: 0.91 },
      ],
    },
  });

  const bridge = result.candidates[0].bes.championFrontierBridge;
  assert.equal(bridge.evidenceOnly, true);
  assert.equal(bridge.promotionAuthority, false);
  assert.deepEqual(bridge.championIds, ['champion_candidate']);
  assert.deepEqual(bridge.frontierRecordIds, ['frontier_1']);
  assert.deepEqual(bridge.compatibleFamilies, ['harness-routing']);
  assert.equal(bridge.evidenceHook, 'champion_archive_frontier');
  assert.deepEqual(result.candidates[0].evidence.summary.championArchiveIds, ['champion_candidate']);
  assert.deepEqual(result.candidates[0].evidence.summary.frontierRecordIds, ['frontier_1']);
  assert.ok(result.candidates[0].promotion.blockedReasons.includes('missing_external_policy_evidence'));
});

test('external policy evidence is recorded but does not grant BES lane apply authority', async () => {
  const result = await runBesLaneRuntime({
    lane: 'harness',
    taskId: 'task-policy-evidence',
    candidates: [
      {
        candidateId: 'candidate_policy_reviewed',
        externalPolicyEvidence: {
          policyDecisionId: 'policy-review-1',
          reviewer: 'trust-kernel',
          verdict: 'eligible_for_review',
        },
      },
    ],
    evaluator: () => ({ score: 0.95, reasons: ['policy evidence attached'] }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.evidence.sources.includes('external_policy_evidence'), true);
  assert.equal(candidate.evidence.summary.externalPolicyEvidenceId, 'policy-review-1');
  assert.equal(candidate.promotion.allowed, false);
  assert.deepEqual(candidate.promotion.blockedReasons, ['evidence_only_lane']);
});

test('live BES fusion keeps candidate-local trajectory provenance scoped per candidate', async () => {
  const result = await runBesLaneRuntime({
    lane: 'code',
    taskId: 'task-trajectory-scope',
    candidates: [
      {
        candidateId: 'candidate_a',
        trajectory: { operator: 'mutation', parents: ['seed_a'] },
      },
      {
        candidateId: 'candidate_b',
        trajectory: { operator: 'mutation', parents: ['seed_b'] },
      },
    ],
    evaluator: () => ({ score: 0.5, reasons: ['trajectory scoped'] }),
  });

  const candidateA = result.candidates.find((candidate) => candidate.candidateId === 'candidate_a');
  const candidateB = result.candidates.find((candidate) => candidate.candidateId === 'candidate_b');

  assert.deepEqual(candidateA.bes.fusion.live.trajectoryOperators.map((operator) => operator.parents), [['seed_a']]);
  assert.deepEqual(candidateB.bes.fusion.live.trajectoryOperators.map((operator) => operator.parents), [['seed_b']]);
});

test('emits a blocked BES lane event when runtime execution fails', async () => {
  const events = [];

  await assert.rejects(
    () => runBesLaneRuntimeWithEvents({
      lane: 'memory',
      taskId: 'task-blocked',
      candidates: [{ candidateId: 'memory_candidate_1' }],
      evaluator: () => {
        throw new Error('memory evaluator unavailable');
      },
      emitEvent: async (event) => events.push(event),
    }),
    /memory evaluator unavailable/,
  );

  assert.deepEqual(events.map((event) => event.type), ['bes_lane.started', 'bes_lane.blocked']);
  assert.equal(events[1].lane, 'memory');
  assert.equal(events[1].reason, 'memory evaluator unavailable');
});
