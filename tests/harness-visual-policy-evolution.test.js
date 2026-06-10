import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateVisualPolicyCandidate,
  proposeVisualPolicies,
} from '../src/harness-sidecar/meta/visualPolicyEvolution.js';
import { selectVerifiersForTask } from '../src/harness-sidecar/tools/verifierSelector.js';

test('visual policy evolution treats false positive and false negative cases as hard cases', () => {
  const candidates = proposeVisualPolicies({
    coreset: [
      { caseId: 'visual_fp', reason: 'visual_false_positive' },
      { caseId: 'visual_fn', reason: 'visual_false_negative' },
    ],
  });

  assert.equal(candidates[0].status, 'shadow_only');
  assert.deepEqual(candidates[0].sourceCaseIds, ['visual_fp', 'visual_fn']);
  assert.equal(candidates[0].hardCaseReasons.includes('visual_false_positive'), true);
  assert.equal(candidates[0].hardCaseReasons.includes('visual_false_negative'), true);
});

test('visual candidates tune thresholds and route workers by task', () => {
  const [candidate] = proposeVisualPolicies({
    coreset: [{ caseId: 'ocr_case', reason: 'visual_false_negative', taskType: 'pdf' }],
    baselinePolicy: {
      scoreThreshold: 0.8,
      confidenceThreshold: 0.7,
      routes: { pdf: ['pdf', 'ocr'] },
    },
  });

  assert.equal(candidate.scoreThreshold <= 0.8, true);
  assert.equal(candidate.confidenceThreshold <= 0.7, true);
  assert.deepEqual(candidate.routes.pdf, ['pdf', 'ocr']);
  assert.deepEqual(candidate.routes.screenshot, ['screenshot']);
  assert.deepEqual(candidate.routes.diff, ['screenshot', 'diff']);
});

test('visual candidates expose budget-aware VLM routing for benchmark cases', () => {
  const [candidate] = proposeVisualPolicies({
    coreset: [{
      caseId: 'chart_case',
      reason: 'visual_false_negative',
      visualCase: {
        caseId: 'visual_case:task:chart',
        benchmarkKind: 'chart',
        confidenceSignals: { lowConfidence: true, verifierConfidence: 0.33 },
        budget: { tokensEstimated: 2400 },
      },
      budget: { pressure: 0.93, remainingVisionTokens: 1200 },
    }],
    baselinePolicy: {
      routes: {
        chart: ['chart', 'vlm_high_accuracy'],
      },
    },
  });

  assert.equal(candidate.vlmRouting.mode, 'budget_aware_shadow');
  assert.equal(candidate.vlmRouting.budgetMode, 'downshift');
  assert.deepEqual(candidate.vlmRouting.routeByCaseKind.chart, ['chart', 'vlm_fast']);
  assert.equal(candidate.vlmRouting.cases[0].caseId, 'visual_case:task:chart');
  assert.equal(candidate.vlmRouting.cases[0].budget.pressure, 0.93);
});

test('visual evaluator penalizes vlm-only pass without artifact support', () => {
  const decision = evaluateVisualPolicyCandidate({
    candidate: { scoreThreshold: 0.75, confidenceThreshold: 0.65, routes: {}, status: 'shadow_only' },
    visualCase: { vlmPassed: true, artifactSupported: false, expectedArtifactKinds: ['screenshot'] },
  });

  assert.equal(decision.reasons.includes('vlm_only_without_artifact_support'), true);
  assert.equal(decision.score < 0.5, true);
  assert.equal(decision.safety.status, 'shadow_only');
});

test('verifier selector accepts visual policy metadata without changing default selection', () => {
  const registry = {
    verifiers: [
      { name: 'unit', kind: 'unit', appliesTo: ['**/*.js'] },
      { name: 'visual', kind: 'visual', appliesTo: ['public/**'] },
    ],
    byName: {},
  };

  const selected = selectVerifiersForTask({
    changedFiles: ['public/app.js'],
    registry,
    visualPolicy: { policyId: 'visual_shadow', status: 'shadow_only', routes: { screenshot: ['visual'] } },
  });

  assert.equal(selected[0].name, 'visual');
  assert.deepEqual(selected[0].policy, { policyId: 'visual_shadow', status: 'shadow_only', mode: 'metadata_only' });
});
