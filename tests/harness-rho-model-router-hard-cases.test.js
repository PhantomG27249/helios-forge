import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRhoCoreset } from '../src/harness-sidecar/rho/coresetBuilder.js';
import {
  buildModelRouterCoreset,
  classifyModelRouterFailure,
  selectModelRouterHardCases,
} from '../src/harness-sidecar/rho/modelRouterHardCases.js';

test('classifies model-router failure modes from council, champion, reviewer, cost, and safety evidence', () => {
  const cases = [
    {
      taskId: 'static-won',
      modelRouter: { selectedModel: 'fast', solved: false },
      staticCouncil: { solved: true },
    },
    {
      taskId: 'best-single-won',
      modelRouter: { selectedModel: 'fast', score: 0.42 },
      bestSingle: { model: 'deep', score: 0.88, solved: true },
    },
    {
      taskId: 'reviewer-caught',
      attempt: { role: 'implementer', modelProfile: 'fast' },
      review: { caughtFailure: true, reviewerModel: 'critic' },
    },
    {
      taskId: 'wrong-champion',
      council: { disagreement: { level: 0.91 }, championCorrect: false },
    },
    {
      taskId: 'costly-equal',
      modelRouter: { selectedModel: 'expensive', score: 0.82, latencyMs: 9000, costEstimate: 1.2 },
      bestSingle: { model: 'cheap', score: 0.83, latencyMs: 800, costEstimate: 0.03 },
    },
    {
      taskId: 'safety-arm',
      modelRouter: { selectedModel: 'unsafe', safetyBlocked: true },
    },
  ];

  assert.deepEqual(
    cases.map((trace) => classifyModelRouterFailure(trace).failureModes[0]),
    [
      'model_router_wrong_model',
      'model_router_best_single_regression',
      'model_router_wrong_model',
      'model_router_council_disagreement_missed',
      'model_router_latency_regression',
      'model_router_safety_regression',
    ],
  );
});

test('selects diverse model-router hard cases with bounded evidence metadata', () => {
  const selected = selectModelRouterHardCases({
    maxCases: 3,
    traces: [
      {
        taskId: 'safe',
        modelRouter: { selectedModel: 'balanced', score: 0.9 },
        bestSingle: { model: 'balanced', score: 0.9 },
      },
      {
        taskId: 'deep-regression',
        role: 'implementer',
        taskType: 'code',
        rawPrompt: 'must not be persisted',
        modelRouter: { selectedModel: 'fast', score: 0.3 },
        bestSingle: { model: 'deep', score: 0.92, solved: true },
      },
      {
        taskId: 'safety-regression',
        role: 'reviewer',
        modelRouter: { selectedModel: 'critic', safetyBlocked: true },
      },
      {
        taskId: 'latency-regression',
        role: 'implementer',
        modelRouter: { selectedModel: 'slow', score: 0.81, latencyMs: 10000, costEstimate: 0.8 },
        bestSingle: { model: 'fast', score: 0.82, latencyMs: 700, costEstimate: 0.02 },
      },
    ],
  });

  assert.deepEqual(selected.map((item) => item.taskId), [
    'safety-regression',
    'deep-regression',
    'latency-regression',
  ]);
  assert.equal(selected.every((item) => item.target === 'model_routing_policy'), true);
  assert.equal(selected.every((item) => item.evidence.authority === 'evidence_only'), true);
  assert.equal(selected.every((item) => item.evidence.canPromote === false), true);
  assert.equal(JSON.stringify(selected).includes('must not be persisted'), false);
});

test('builds a router coreset and annotates general RHO coreset metadata with router failures', () => {
  const traces = [
    {
      taskId: 'router-a',
      modelRouter: { selectedModel: 'fast', score: 0.41 },
      bestSingle: { model: 'deep', score: 0.9, solved: true },
    },
    {
      taskId: 'normal-failure',
      status: 'failed',
      failureModes: ['tool_timeout'],
    },
  ];

  const routerCoreset = buildModelRouterCoreset({ traces, maxCases: 2 });
  const generalCoreset = buildRhoCoreset({ traces, limit: 2 });

  assert.equal(routerCoreset.items.length, 1);
  assert.equal(routerCoreset.items[0].failureModes.includes('model_router_best_single_regression'), true);
  const routerItem = generalCoreset.items.find((item) => item.taskId === 'router-a');
  assert.equal(routerItem.metadata.modelRouter.failureModes.includes('model_router_best_single_regression'), true);
  assert.equal(routerItem.reasons.includes('model_router_best_single_regression'), true);
});
