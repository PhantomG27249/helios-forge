import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HarnessOptimizer } from '../src/harness-sidecar/meta/harnessOptimizer.js';
import {
  evaluateModelRoutingPolicyCandidate,
  proposeModelRoutingPolicies,
  runModelRoutingPolicyLane,
} from '../src/harness-sidecar/meta/modelRoutingPolicyEvolution.js';

const routerCoreset = {
  items: [
    {
      taskId: 'wrong-impl',
      role: 'implementer',
      taskType: 'code',
      selectedModel: 'fast',
      bestModel: 'deep',
      failureModes: ['model_router_wrong_model'],
      score: 9,
    },
    {
      taskId: 'slow-review',
      role: 'reviewer',
      taskType: 'review',
      selectedModel: 'deep',
      bestModel: 'cheap',
      qualityDelta: 0.01,
      failureModes: ['model_router_latency_regression'],
      score: 5,
    },
    {
      taskId: 'unsafe-arm',
      role: 'implementer',
      taskType: 'code',
      selectedModel: 'unsafe',
      failureModes: ['model_router_safety_regression'],
      score: 8,
    },
  ],
};

test('proposes evidence-only model-routing policy candidates from router hard cases', () => {
  const candidates = proposeModelRoutingPolicies({
    coreset: routerCoreset,
    baselinePolicy: { explorationFloor: 0.05 },
    maxCandidates: 4,
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates.every((candidate) => candidate.target === 'model_routing_policy'), true);
  assert.equal(candidates.every((candidate) => candidate.evidence.authority === 'evidence_only'), true);
  assert.equal(candidates.every((candidate) => candidate.evidence.canPromote === false), true);
  assert.equal(candidates[0].policyPatch.explorationFloor > 0.05, true);
  assert.equal(candidates[0].policyPatch.roleArmWeights.implementer.deep > 1, true);
  assert.equal(candidates[1].policyPatch.roleArmWeights.reviewer.cheap > 1, true);
  assert.equal(candidates[2].policyPatch.quarantinedArms.includes('unsafe'), true);
});

test('evaluates model-routing candidates without promotion authority', () => {
  const [candidate] = proposeModelRoutingPolicies({
    coreset: routerCoreset,
    baselinePolicy: { explorationFloor: 0.05 },
    maxCandidates: 1,
  });

  const evaluation = evaluateModelRoutingPolicyCandidate({
    candidate,
    replayCase: {
      taskId: 'wrong-impl',
      bestModel: 'deep',
      selectedModel: 'fast',
      candidateSelectedModel: 'deep',
    },
  });

  assert.equal(evaluation.candidateId, candidate.candidateId);
  assert.equal(evaluation.target, 'model_routing_policy');
  assert.equal(evaluation.rewardDelta > 0, true);
  assert.equal(evaluation.authority, 'evidence_only');
  assert.equal(evaluation.canPromote, false);
});

test('runs a model-routing policy lane over coreset replay cases', () => {
  const lane = runModelRoutingPolicyLane({
    coreset: routerCoreset,
    baselinePolicy: { explorationFloor: 0.05 },
    evaluate: ({ candidate, replayCase }) => ({
      candidateId: candidate.candidateId,
      replayCaseId: replayCase.taskId,
      rewardDelta: candidate.sourceCaseIds.includes(replayCase.taskId) ? 0.2 : 0,
      safetyDelta: 0,
      latencyDelta: 0,
      authority: 'evidence_only',
      canPromote: false,
    }),
  });

  assert.equal(lane.target, 'model_routing_policy');
  assert.equal(lane.candidates.length > 0, true);
  assert.equal(lane.evaluations.length, lane.candidates.length * routerCoreset.items.length);
  assert.equal(lane.frontier.every((item) => item.authority === 'evidence_only'), true);
  assert.equal(lane.frontier.every((item) => item.canPromote === false), true);
});

test('HarnessOptimizer supports model_routing_policy proposal target', () => {
  const result = new HarnessOptimizer({
    mode: 'rho-meta',
    maxCandidates: 2,
    baselinePolicy: { explorationFloor: 0.05 },
  }).propose({
    target: 'model_routing_policy',
    coreset: routerCoreset,
  });

  assert.equal(result.target, 'model_routing_policy');
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates.every((candidate) => candidate.target === 'model_routing_policy'), true);
});
