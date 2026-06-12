import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMultimodalRequest } from '../src/harness-sidecar/model/multimodalRequestBuilder.js';
import {
  createVisualContextItem,
  decideMultimodalBudgetPolicy,
} from '../src/harness-sidecar/vlm/visualContextPolicy.js';

const visualItem = createVisualContextItem({
  artifactId: 'screenshot_1',
  type: 'screenshot',
  summary: 'Preview screenshot',
  artifacts: { image: '.harness/visual/preview.png' },
  visualContext: { tokensEstimated: 900 },
});

test('multimodal budget policy falls back to text only without visual context', () => {
  const decision = decideMultimodalBudgetPolicy({
    task: { taskId: 'text-task' },
    endpoint: { supportsVision: true },
    visualItems: [],
  });

  assert.deepEqual(decision, {
    mode: 'text_only',
    budgetCost: 0,
    reasons: ['no_visual_context'],
    adaptiveSearchEvidence: null,
    evidenceOnly: true,
  });
});

test('multimodal budget policy requires VLM for required visual tasks when endpoint supports images', () => {
  const decision = decideMultimodalBudgetPolicy({
    task: { taskId: 'visual-task', vlmRequired: true },
    endpoint: { supportsVision: true },
    visualItems: [visualItem],
    budget: { remainingTokens: 1200 },
  });

  assert.equal(decision.mode, 'vlm_required');
  assert.equal(decision.budgetCost, 900);
  assert.deepEqual(decision.reasons, ['vlm_required_task', 'vision_endpoint_available']);
  assert.equal(decision.evidenceOnly, true);
});

test('multimodal budget policy blocks VLM when visual budget is exhausted', () => {
  const decision = decideMultimodalBudgetPolicy({
    task: { taskId: 'visual-budget', vlmRequired: true },
    endpoint: { supportsVision: true },
    visualItems: [visualItem],
    budget: { remainingVisionTokens: 400 },
  });

  assert.equal(decision.mode, 'text_only');
  assert.equal(decision.budgetCost, 0);
  assert.equal(decision.reasons.includes('vision_budget_exhausted'), true);
});

test('multimodal budget policy treats explicit supportsVision false as authoritative', () => {
  const decision = decideMultimodalBudgetPolicy({
    task: { taskId: 'visual-capability', vlmRequired: true },
    endpoint: { supportsVision: false, capabilities: ['text', 'image'] },
    visualItems: [visualItem],
    budget: { remainingTokens: 2000 },
  });

  assert.equal(decision.mode, 'text_only');
  assert.deepEqual(decision.reasons, ['vision_capability_mismatch']);
});

test('multimodal budget policy uses optional VLM when visual evidence and budget are available', () => {
  const decision = decideMultimodalBudgetPolicy({
    task: { taskId: 'optional-visual' },
    endpoint: { capabilities: ['text', 'image'] },
    visualItems: [visualItem],
    budget: { remainingTokens: 2000 },
  });

  assert.equal(decision.mode, 'vlm_optional');
  assert.equal(decision.budgetCost, 900);
  assert.equal(decision.reasons.includes('visual_context_available'), true);
});

test('multimodal budget policy includes adaptive-search feedback as evidence only', () => {
  const decision = decideMultimodalBudgetPolicy({
    task: { taskId: 'adaptive-visual' },
    endpoint: { supportsVision: true },
    visualItems: [visualItem],
    budget: { remainingTokens: 2000 },
    adaptiveAction: {
      actionId: 'visual-arm-1',
      contextId: 'adaptive-visual',
      selectedArmId: 'vlm_optional',
      reward: 0.64,
    },
  });

  assert.equal(decision.adaptiveSearchEvidence.action.trace.type, 'ab_mcts.action_selected');
  assert.equal(decision.adaptiveSearchEvidence.action.trace.contextId, 'adaptive-visual');
  assert.equal(decision.adaptiveSearchEvidence.outcome.type, 'ab_mcts.outcome_recorded');
  assert.equal(decision.adaptiveSearchEvidence.evidenceOnly, true);
});

test('multimodal request builder respects text-only budget decisions for non-vision endpoints', () => {
  const decision = decideMultimodalBudgetPolicy({
    task: { taskId: 'text-only-endpoint', vlmRequired: true },
    endpoint: { supportsVision: false, capabilities: ['text'] },
    visualItems: [visualItem],
    budget: { remainingTokens: 2000 },
  });
  const request = buildMultimodalRequest({
    profileName: 'text-only-test',
    profileOverride: { name: 'text-only-test', supportsVision: false },
    prompt: 'Describe the fallback.',
    visualItems: [visualItem],
    multimodalBudgetPolicy: decision,
  });

  assert.equal(decision.mode, 'text_only');
  assert.equal(decision.reasons.includes('vision_capability_mismatch'), true);
  assert.equal(request.visionInputs.length, 0);
  assert.equal(request.messages[0].content.some((part) => part.type === 'image_reference'), false);
});
