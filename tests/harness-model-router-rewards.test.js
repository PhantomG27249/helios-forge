import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_MODEL_ROUTER_REWARD_WEIGHTS,
  modelRouterRewardFromAttempt,
  modelRouterRewardsFromSwarmResult,
} from '../src/harness-sidecar/model/modelRouterRewards.js';

test('verifier pass with high score yields a high bounded router reward', () => {
  const reward = modelRouterRewardFromAttempt({
    attempt: {
      attemptId: 'a1',
      role: 'implementer',
      taskType: 'code',
      score: 0.82,
      verifierPassed: true,
      model: { route: { modelProfile: 'fast', endpointProfile: 'local' } },
      metrics: { latencyMs: 1200, costEstimate: 0.01 },
      output: { text: 'must-not-cross' },
    },
    councilReport: { disagreement: { status: 'none' } },
    weights: DEFAULT_MODEL_ROUTER_REWARD_WEIGHTS,
  });

  assert.equal(reward.armId, 'fast');
  assert.ok(reward.reward > 0.7);
  assert.equal(reward.evidence.verifierPassed, true);
  assert.equal(reward.evidence.score, 0.82);
  assert.equal(reward.evidence.modelProfile, 'fast');
  assert.equal(reward.evidence.endpointProfile, 'local');
  assert.equal(JSON.stringify(reward).includes('must-not-cross'), false);
});

test('verifier failure and safety block produce strong negative evidence', () => {
  const failed = modelRouterRewardFromAttempt({
    attempt: {
      attemptId: 'a2',
      role: 'implementer',
      taskType: 'code',
      score: 0.91,
      verifierPassed: false,
      model: { route: { modelProfile: 'fast', endpointProfile: 'local' } },
    },
  });
  const blocked = modelRouterRewardFromAttempt({
    attempt: {
      attemptId: 'a3',
      role: 'reviewer',
      taskType: 'code',
      score: 1,
      verifierPassed: true,
      safetyBlocked: true,
      model: { route: { modelProfile: 'critic', endpointProfile: 'local' } },
    },
  });

  assert.ok(failed.reward < 0.25);
  assert.ok(blocked.reward <= failed.reward);
  assert.equal(blocked.evidence.safetyBlocked, true);
  assert.equal(blocked.reasons.includes('safety_blocked'), true);
});

test('council disagreement reduces confidence without erasing verifier evidence', () => {
  const agreed = modelRouterRewardFromAttempt({
    attempt: {
      attemptId: 'a4',
      role: 'implementer',
      taskType: 'code',
      score: 0.8,
      verifierPassed: true,
      model: { route: { modelProfile: 'deep', endpointProfile: 'local' } },
    },
    councilReport: { disagreement: { status: 'none' } },
  });
  const disagreed = modelRouterRewardFromAttempt({
    attempt: {
      attemptId: 'a5',
      role: 'implementer',
      taskType: 'code',
      score: 0.8,
      verifierPassed: true,
      model: { route: { modelProfile: 'deep', endpointProfile: 'local' } },
    },
    councilReport: { disagreement: { status: 'present' } },
  });

  assert.ok(disagreed.reward < agreed.reward);
  assert.ok(disagreed.reward > 0.5);
  assert.equal(disagreed.evidence.verifierPassed, true);
  assert.equal(disagreed.reasons.includes('council_disagreement'), true);
});

test('latency and cost bonuses only apply after quality gates pass', () => {
  const fastPassing = modelRouterRewardFromAttempt({
    attempt: {
      attemptId: 'a6',
      role: 'implementer',
      taskType: 'code',
      score: 0.75,
      verifierPassed: true,
      model: { route: { modelProfile: 'fast', endpointProfile: 'local' } },
      metrics: { latencyMs: 500, costEstimate: 0.01 },
    },
  });
  const slowPassing = modelRouterRewardFromAttempt({
    attempt: {
      attemptId: 'a7',
      role: 'implementer',
      taskType: 'code',
      score: 0.75,
      verifierPassed: true,
      model: { route: { modelProfile: 'slow', endpointProfile: 'local' } },
      metrics: { latencyMs: 20000, costEstimate: 2 },
    },
  });
  const fastFailing = modelRouterRewardFromAttempt({
    attempt: {
      attemptId: 'a8',
      role: 'implementer',
      taskType: 'code',
      score: 0.75,
      verifierPassed: false,
      model: { route: { modelProfile: 'fast', endpointProfile: 'local' } },
      metrics: { latencyMs: 200, costEstimate: 0 },
    },
  });

  assert.ok(fastPassing.reward > slowPassing.reward);
  assert.ok(fastFailing.reward < 0.25);
});

test('malformed attempt outcomes produce no reward update', () => {
  assert.equal(modelRouterRewardFromAttempt(), null);
  assert.equal(modelRouterRewardFromAttempt({ attempt: { attemptId: 'missing-route', verifierPassed: true } }), null);
  assert.equal(modelRouterRewardFromAttempt({
    attempt: {
      attemptId: 'missing-verifier',
      model: { route: { modelProfile: 'fast' } },
    },
  }), null);
});

test('swarm result conversion returns bounded rewards and omits raw outputs', () => {
  const rewards = modelRouterRewardsFromSwarmResult({
    result: {
      task: { taskId: 't1', type: 'code' },
      attempts: [
        {
          attemptId: 'a9',
          role: 'implementer',
          score: 0.9,
          verifierPassed: true,
          model: { route: { modelProfile: 'fast', endpointProfile: 'local' } },
          output: { text: 'raw-secret-value' },
        },
        {
          attemptId: 'bad',
          role: 'reviewer',
          model: { route: { modelProfile: 'critic' } },
        },
      ],
      councilReport: { disagreement: { status: 'none' } },
    },
  });

  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].evidence.taskId, 't1');
  assert.equal(rewards[0].reward <= 1, true);
  assert.equal(rewards[0].reward >= 0, true);
  assert.equal(JSON.stringify(rewards).includes('raw-secret-value'), false);
});
