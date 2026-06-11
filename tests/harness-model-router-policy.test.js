import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createModelRouterPolicy,
  normalizeRouterArms,
  sampleBeta,
} from '../src/harness-sidecar/model/modelRouterPolicy.js';
import {
  createModelRouterState,
  modelRouterKey,
  sanitizeRouterEvidence,
} from '../src/harness-sidecar/model/modelRouterState.js';

function seededRng(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let value = hash;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test('model router state records fractional posterior rewards without secret evidence', () => {
  const key = modelRouterKey({
    role: 'reviewer',
    taskType: 'code',
    nodeKind: 'critique',
    capabilityTags: ['patch', 'review'],
  });
  const state = createModelRouterState();

  state.recordReward({
    key,
    armId: 'critic_low_temp',
    reward: 0.8,
    evidence: {
      taskId: 't1',
      attemptId: 'a1',
      role: 'reviewer',
      modelProfile: 'critic_low_temp',
      endpointProfile: 'critic',
      verifierPassed: true,
      score: 0.8,
      latencyMs: 1200,
      costEstimate: 0.02,
      safetyBlocked: false,
      failureModes: ['minor_style'],
      prompt: 'raw-secret-value',
      output: 'must-not-cross',
      headers: { Authorization: 'Bearer never-return-this' },
      token: 'secret-token',
      endpointConfig: { apiKey: 'secret-key' },
    },
  });

  const arm = state.snapshot().keys[key].arms.critic_low_temp;
  assert.equal(arm.alpha, 1.8);
  assert.equal(arm.beta, 1.2);
  assert.equal(arm.successes, 0.8);
  assert.equal(arm.failures, 0.2);
  assert.equal(arm.observations, 1);
  assert.deepEqual(arm.evidence[0], {
    taskId: 't1',
    attemptId: 'a1',
    role: 'reviewer',
    modelProfile: 'critic_low_temp',
    endpointProfile: 'critic',
    verifierPassed: true,
    score: 0.8,
    latencyMs: 1200,
    costEstimate: 0.02,
    safetyBlocked: false,
    failureModes: ['minor_style'],
  });

  const serialized = JSON.stringify(state.snapshot());
  assert.equal(serialized.includes('raw-secret-value'), false);
  assert.equal(serialized.includes('must-not-cross'), false);
  assert.equal(serialized.includes('never-return-this'), false);
  assert.equal(serialized.includes('secret-token'), false);
  assert.equal(serialized.includes('secret-key'), false);
});

test('model router state clamps rewards and restores serializable snapshots', () => {
  const key = modelRouterKey({ role: 'implementer', taskType: 'repair' });
  const state = createModelRouterState({ priorAlpha: 2, priorBeta: 3 });

  assert.deepEqual(state.getArm({ key, armId: 'fast_model' }), {
    armId: 'fast_model',
    alpha: 2,
    beta: 3,
    successes: 0,
    failures: 0,
    observations: 0,
    evidence: [],
  });

  state.recordReward({ key, armId: 'fast_model', reward: 1.7, evidence: { score: 2 } });
  state.recordReward({ key, armId: 'fast_model', reward: -0.4, evidence: { score: -1 } });

  const restored = createModelRouterState({ initialState: state.snapshot() });
  const arm = restored.getArm({ key, armId: 'fast_model' });
  assert.equal(arm.successes, 1);
  assert.equal(arm.failures, 1);
  assert.equal(arm.alpha, 3);
  assert.equal(arm.beta, 4);
  assert.deepEqual(arm.evidence.map((entry) => entry.score), [1, 0]);
});

test('sanitizeRouterEvidence keeps bounded router fields only', () => {
  assert.deepEqual(
    sanitizeRouterEvidence({
      taskId: 123,
      attemptId: 'a1',
      score: 0.55,
      latencyMs: '42',
      costEstimate: '0.3',
      failureModes: ['bad_patch', 7, ''],
      apiKey: 'never-return-this',
      rawPrompt: 'secret prompt',
    }),
    {
      taskId: '123',
      attemptId: 'a1',
      score: 0.55,
      latencyMs: 42,
      costEstimate: 0.3,
      failureModes: ['bad_patch', '7'],
    },
  );
});

test('model router policy selects evidence-only arms with deterministic Thompson sampling', () => {
  const key = modelRouterKey({ role: 'implementer', taskType: 'code' });
  const state = createModelRouterState();
  for (let i = 0; i < 12; i += 1) {
    state.recordReward({ key, armId: 'deep_model', reward: 1, evidence: { taskId: `win-${i}` } });
    state.recordReward({ key, armId: 'fast_model', reward: 0.05, evidence: { taskId: `loss-${i}` } });
  }

  const policy = createModelRouterPolicy({
    state,
    rng: seededRng('router-test'),
    explorationFloor: 0.05,
  });
  const decision = policy.selectArm({
    key,
    role: 'implementer',
    arms: [
      { armId: 'fast_model', modelProfile: 'fast_model', endpointProfile: 'local' },
      { armId: 'deep_model', modelProfile: 'deep_model', endpointProfile: 'deep' },
    ],
  });

  assert.equal(decision.type, 'model_router.arm_selected');
  assert.equal(decision.authority, 'evidence_only');
  assert.equal(decision.canPromote, false);
  assert.equal(decision.armId, 'deep_model');
  assert.equal(decision.modelProfile, 'deep_model');
  assert.equal(decision.endpointProfile, 'deep');
  assert.equal(decision.posterior.observations, 12);
  assert.deepEqual(
    decision.alternatives.map((arm) => arm.armId).sort(),
    ['deep_model', 'fast_model'],
  );
  assert.equal(JSON.stringify(decision).includes('raw-secret-value'), false);
});

test('model router policy keeps weak arms eligible through exploration floor', () => {
  const key = modelRouterKey({ role: 'reviewer', taskType: 'code' });
  const state = createModelRouterState();
  for (let i = 0; i < 20; i += 1) {
    state.recordReward({ key, armId: 'critic', reward: 1 });
    state.recordReward({ key, armId: 'weak_but_allowed', reward: 0 });
  }
  const policy = createModelRouterPolicy({
    state,
    rng: seededRng('floor-test'),
    explorationFloor: 0.1,
    maxArmsPerDecision: 1,
  });

  const decision = policy.selectArm({
    key,
    role: 'reviewer',
    arms: [
      { armId: 'critic', modelProfile: 'critic' },
      { armId: 'weak_but_allowed', modelProfile: 'weak_but_allowed' },
    ],
  });

  assert.equal(decision.alternatives.length, 2);
  assert.equal(decision.alternatives.some((arm) => arm.armId === 'weak_but_allowed'), true);
});

test('model router policy excludes safety-blocked and unhealthy arms', () => {
  const key = modelRouterKey({ role: 'reviewer', taskType: 'code' });
  const policy = createModelRouterPolicy({
    state: createModelRouterState(),
    rng: seededRng('exclude-test'),
  });

  const decision = policy.selectArm({
    key,
    role: 'reviewer',
    arms: [
      { armId: 'unsafe', modelProfile: 'unsafe', safetyBlocked: true },
      { armId: 'down', modelProfile: 'down', health: 'unhealthy' },
      { armId: 'healthy', modelProfile: 'healthy', endpointProfile: 'local' },
    ],
  });

  assert.equal(decision.armId, 'healthy');
  assert.deepEqual(decision.alternatives.map((arm) => arm.armId), ['healthy']);
});

test('normalizeRouterArms derives eligible role routes from council configuration', () => {
  assert.deepEqual(
    normalizeRouterArms({
      role: 'reviewer',
      council: {
        roleRoutes: {
          implementer: { modelProfile: 'fast', endpointProfile: 'local' },
          reviewer: { modelProfile: 'critic', endpointProfile: 'critic' },
        },
      },
      taskContext: {
        routerArms: [
          { armId: 'extra', role: 'reviewer', modelProfile: 'extra', endpointProfile: 'local' },
          { armId: 'other', role: 'researcher', modelProfile: 'other' },
        ],
      },
    }),
    [
      { armId: 'critic', role: 'reviewer', modelProfile: 'critic', endpointProfile: 'critic' },
      { armId: 'extra', role: 'reviewer', modelProfile: 'extra', endpointProfile: 'local' },
    ],
  );
});

test('sampleBeta is deterministic with injected RNG and stays bounded', () => {
  const rng = seededRng('beta-test');
  const first = sampleBeta({ alpha: 4, beta: 2, rng });
  const second = sampleBeta({ alpha: 4, beta: 2, rng: seededRng('beta-test') });
  assert.equal(first, second);
  assert.ok(first >= 0);
  assert.ok(first <= 1);
});
