import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildAdaptiveSearchContextForModelRouter,
  buildAdaptiveSearchContextForContextMemory,
  buildAdaptiveSearchContextForResearch,
  buildAdaptiveSearchContextForVerifier,
  buildAdaptiveSearchContextForVisual,
  deriveModelChoiceArmsFromRouterHardCases,
  normalizeAdaptiveSearchRewardForModelRouter,
  normalizeAdaptiveSearchRewardForContextMemory,
  normalizeAdaptiveSearchRewardForResearch,
  normalizeAdaptiveSearchRewardForVerifier,
  normalizeAdaptiveSearchRewardForVisual,
} from '../src/harness-sidecar/bes/adaptiveSearchAdapters.js';

test('verifier adapter builds pure scheduler context and normalizes pass confidence reward', () => {
  const input = {
    taskId: 'task_verify',
    changedFiles: ['public/app.js'],
    recentFailures: ['unit'],
    verifierEvidence: [{ name: 'unit', passed: false, confidence: 0.5 }],
    budget: { pressure: 0.25 },
  };

  const context = buildAdaptiveSearchContextForVerifier(input);
  const repeated = buildAdaptiveSearchContextForVerifier(input);
  const passingReward = normalizeAdaptiveSearchRewardForVerifier({
    passed: true,
    confidence: 0.92,
    heldOutPassed: true,
    cost: { pressure: 0.2, latencyMs: 800 },
  });
  const failingReward = normalizeAdaptiveSearchRewardForVerifier({
    passed: false,
    confidence: 0.92,
    safetyRejected: true,
    cost: { pressure: 0.2, latencyMs: 800 },
  });

  assert.deepEqual(context, repeated);
  assert.equal(context.subsystem, 'verifier');
  assert.equal(context.taskId, 'task_verify');
  assert.equal(context.signals.visualSurface, true);
  assert.equal(context.evidence.length, 1);
  assert.equal(passingReward > failingReward, true);
  assert.equal(passingReward <= 1 && passingReward >= 0, true);
  assert.equal(failingReward <= 1 && failingReward >= 0, true);
});

test('visual adapter favors artifact evidence quality and penalizes approval rejection', () => {
  const context = buildAdaptiveSearchContextForVisual({
    taskId: 'task_visual',
    artifacts: [{ kind: 'screenshot', quality: 0.8 }],
    diffConfidence: 0.72,
    ocrConfidence: 0.65,
    budget: { pressure: 0.3 },
  });
  const goodReward = normalizeAdaptiveSearchRewardForVisual({
    artifactQuality: 0.9,
    diffConfidence: 0.8,
    vlmConfidence: 0.85,
    cost: { pressure: 0.2 },
  });
  const rejectedReward = normalizeAdaptiveSearchRewardForVisual({
    artifactQuality: 0.9,
    diffConfidence: 0.8,
    vlmConfidence: 0.85,
    approvalRejected: true,
    cost: { pressure: 0.2 },
  });

  assert.equal(context.subsystem, 'visual');
  assert.equal(context.evidenceCount, 1);
  assert.equal(context.signals.hasVisualEvidence, true);
  assert.equal(goodReward > rejectedReward, true);
});

test('research adapter exposes source and contradiction signals with bounded reward', () => {
  const context = buildAdaptiveSearchContextForResearch({
    taskId: 'task_research',
    sources: [{ url: 'https://example.test/a' }, { url: 'https://example.test/b' }],
    contradictions: [{ claim: 'version mismatch' }],
    synthesisConfidence: 0.45,
    budget: { pressure: 0.4 },
  });
  const reward = normalizeAdaptiveSearchRewardForResearch({
    sourceQuality: 0.7,
    contradictionResolved: true,
    synthesisConfidence: 0.82,
    citationCoverage: 0.75,
    cost: { pressure: 0.25 },
  });

  assert.equal(context.subsystem, 'research');
  assert.equal(context.evidenceCount, 2);
  assert.equal(context.signals.hasContradictions, true);
  assert.equal(context.signals.synthesisConfidence, 0.45);
  assert.equal(reward <= 1 && reward >= 0, true);
});

test('context memory adapter captures breadth and graph depth signals without mutating input', () => {
  const input = {
    taskId: 'task_memory',
    retrieval: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], sourcePaths: ['a.js', 'b.js'] },
    graph: { depth: 2, neighbors: [{ id: 'n1' }] },
    memoryCandidates: [{ id: 'memory_1', confidence: 0.7 }],
    compaction: { pressure: 0.83 },
    budget: { pressure: 0.55 },
  };
  const before = JSON.stringify(input);

  const context = buildAdaptiveSearchContextForContextMemory(input);
  const reward = normalizeAdaptiveSearchRewardForContextMemory({
    retrievalPrecision: 0.76,
    sourceDiversity: 0.67,
    graphRelevance: 0.7,
    memoryUsefulness: 0.8,
    compactionLoss: 0.1,
    cost: { pressure: 0.45 },
  });

  assert.equal(JSON.stringify(input), before);
  assert.equal(context.subsystem, 'context_memory');
  assert.equal(context.evidenceCount, 3);
  assert.equal(context.signals.sourceDiversity, 2);
  assert.equal(context.signals.graphDepth, 2);
  assert.equal(context.signals.compactionPressure, 0.83);
  assert.equal(reward <= 1 && reward >= 0, true);
});

test('model router adapter derives model-choice exploration arms from hard-case evidence', () => {
  const hardCases = [
    {
      taskId: 'wrong-model',
      role: 'implementer',
      taskType: 'code',
      selectedModel: 'fast',
      bestModel: 'deep',
      failureModes: ['model_router_wrong_model'],
      evidence: { authority: 'evidence_only', canPromote: false },
    },
    {
      taskId: 'unsafe-model',
      role: 'reviewer',
      taskType: 'review',
      selectedModel: 'unsafe',
      failureModes: ['model_router_safety_regression'],
    },
  ];

  const arms = deriveModelChoiceArmsFromRouterHardCases({ hardCases });
  const context = buildAdaptiveSearchContextForModelRouter({ taskId: 'router-replay', hardCases });
  const reward = normalizeAdaptiveSearchRewardForModelRouter({
    verifierPassed: true,
    selectedBestModel: true,
    safetyBlocked: false,
    latencyDelta: -0.1,
  });

  assert.deepEqual(arms.map((arm) => arm.armId), ['explore_implementer_deep', 'quarantine_reviewer_unsafe']);
  assert.equal(arms.every((arm) => arm.authority === 'evidence_only'), true);
  assert.equal(arms.every((arm) => arm.canPromote === false), true);
  assert.equal(context.subsystem, 'model_router');
  assert.equal(context.evidenceCount, 2);
  assert.equal(context.signals.routerFailureCount, 2);
  assert.equal(context.modelChoiceArms.length, 2);
  assert.equal(reward > 0.7, true);
});
