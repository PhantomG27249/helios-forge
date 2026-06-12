import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyDenseSubgoals } from '../src/harness-sidecar/bes/denseSubgoalVerifier.js';
import { judgeDenseSubgoalWithModel } from '../src/harness-sidecar/bes/modelAssistedDenseJudgment.js';

test('model-assisted dense judgment is disabled by default and uses deterministic fallback', async () => {
  let called = false;
  const result = await judgeDenseSubgoalWithModel({
    subgoal: { id: 'run-tests', requiredEvidence: 'npm test' },
    evidence: ['npm test passed on held-out suite'],
    modelProvider: async () => {
      called = true;
      return { satisfied: false };
    },
  });

  assert.equal(called, false);
  assert.equal(result.modelAssisted, false);
  assert.equal(result.status, 'deterministic_fallback');
  assert.equal(result.satisfied, true);
  assert.equal(result.confidence, 0.5);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.promotionAuthority, false);
  assert.equal(result.canPromote, false);
});

test('enabled model-assisted dense judgment is evidence-only with bounded confidence', async () => {
  const result = await judgeDenseSubgoalWithModel({
    subgoal: { id: 'visual-check', requiredEvidence: 'visual verifier passed' },
    evidence: [{ id: 'trace-1', text: 'visual verifier passed', provenanceId: 'trace-1' }],
    policy: { enabled: true, requireProvenance: true, maxConfidence: 0.72 },
    modelProvider: async () => ({
      satisfied: true,
      confidence: 9,
      reasons: ['model sees required visual evidence'],
      provenanceIds: ['trace-1'],
      canPromote: true,
      authority: 'admin',
    }),
  });

  assert.equal(result.modelAssisted, true);
  assert.equal(result.status, 'satisfied');
  assert.equal(result.satisfied, true);
  assert.equal(result.confidence, 0.72);
  assert.deepEqual(result.provenanceIds, ['trace-1']);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.promotionAuthority, false);
  assert.equal(result.canPromote, false);
  assert.equal(JSON.stringify(result).includes('admin'), false);
});

test('model-assisted dense judgment requires provenance before invoking the model', async () => {
  let called = false;
  const result = await judgeDenseSubgoalWithModel({
    subgoal: { id: 'citation', requiredEvidence: 'source citation' },
    evidence: [{ text: 'source citation appears without provenance' }],
    policy: { enabled: true, requireProvenance: true },
    modelProvider: async () => {
      called = true;
      return { satisfied: true };
    },
  });

  assert.equal(called, false);
  assert.equal(result.status, 'insufficient_provenance');
  assert.equal(result.satisfied, false);
  assert.equal(result.reasons.includes('missing_provenance'), true);
  assert.equal(result.evidenceOnly, true);
});

test('model-visible dense judgment inputs are quarantined before provider invocation', async () => {
  let providerInput = null;
  const result = await judgeDenseSubgoalWithModel({
    subgoal: {
      id: 'secret-safe',
      requiredEvidence: 'safe evidence',
      note: 'token=ghp_should_not_leak',
      canPromote: true,
    },
    evidence: [
      {
        id: 'evidence-1',
        text: 'safe evidence from C:\\Users\\jackj\\secret\\trace.json',
        provenanceId: 'trace-safe',
      },
    ],
    policy: { enabled: true, requireProvenance: true },
    modelProvider: async (input) => {
      providerInput = input;
      return { satisfied: true, confidence: 0.66, provenanceIds: ['trace-safe'] };
    },
  });

  const providerSerialized = JSON.stringify(providerInput);
  assert.equal(providerSerialized.includes('ghp_should_not_leak'), false);
  assert.equal(providerSerialized.includes('C:\\Users\\jackj\\secret'), false);
  assert.equal(providerSerialized.includes('"canPromote":true'), false);
  assert.equal(result.quarantine.quarantined, true);
  assert.equal(result.quarantine.reasons.includes('secret_like_value'), true);
  assert.equal(result.quarantine.reasons.includes('unsafe_path_value'), true);
  assert.equal(result.quarantine.reasons.includes('authority_claim_removed'), true);
});

test('dense subgoal verifier merges advisory model judgments without promotion authority', () => {
  const result = verifyDenseSubgoals({
    subgoals: [
      { id: 'requires-model', requiredEvidence: 'semantic evidence' },
      { id: 'still-missing', requiredEvidence: 'not present' },
    ],
    evidence: ['lexical evidence missing'],
    modelJudgments: [
      {
        subgoalId: 'requires-model',
        satisfied: true,
        confidence: 0.7,
        evidenceOnly: true,
        canPromote: true,
        promotionAuthority: true,
      },
    ],
  });

  assert.equal(result.score, 0.5);
  assert.deepEqual(result.satisfiedSubgoalIds, ['requires-model']);
  assert.deepEqual(result.missingSubgoalIds, ['still-missing']);
  assert.equal(result.denseFeedback[0].modelAssisted.satisfied, true);
  assert.equal(result.denseFeedback[0].modelAssisted.canPromote, false);
  assert.equal(result.denseFeedback[0].modelAssisted.promotionAuthority, false);
});
