import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateResearchPolicyCandidate,
  proposeResearchPolicies,
} from '../src/harness-sidecar/meta/researchPolicyEvolution.js';
import { assessNoveltyAndRisk } from '../src/harness-sidecar/research/noveltyControls.js';

test('research policy evolution treats unsupported claims and contradiction misses as hard cases', () => {
  const candidates = proposeResearchPolicies({
    coreset: [
      { caseId: 'unsupported_claim', reason: 'unsupported_claim', claimId: 'c1' },
      { caseId: 'contradiction_missed', reason: 'contradiction_missed', contradictionId: 'k1' },
    ],
  });

  assert.equal(candidates[0].status, 'shadow_only');
  assert.deepEqual(candidates[0].sourceCaseIds, ['unsupported_claim', 'contradiction_missed']);
  assert.equal(candidates[0].hardCaseReasons.includes('unsupported_claim'), true);
  assert.equal(candidates[0].hardCaseReasons.includes('contradiction_missed'), true);
});

test('research candidates rank sources claims contradictions and templates', () => {
  const [candidate] = proposeResearchPolicies({
    coreset: [{ caseId: 'figure_risk', reason: 'figure_only_evidence' }],
    baselinePolicy: {
      sourceGroundingWeight: 0.6,
      contradictionCheckWeight: 0.2,
      figureEvidencePenalty: 0.2,
      reportTemplate: 'standard',
    },
  });

  assert.equal(candidate.sourceGroundingWeight >= 0.6, true);
  assert.equal(candidate.contradictionCheckWeight >= 0.2, true);
  assert.equal(candidate.figureEvidencePenalty >= 0.2, true);
  assert.equal(candidate.reportTemplate, 'evidence_first');
});

test('research evaluator rewards source-grounded evidence and penalizes figure-only risk', () => {
  const grounded = evaluateResearchPolicyCandidate({
    candidate: {
      sourceGroundingWeight: 0.8,
      contradictionCheckWeight: 0.5,
      figureEvidencePenalty: 0.3,
      status: 'shadow_only',
    },
    researchCase: { supportedClaims: 5, unsupportedClaims: 0, figureOnlyClaims: 0, contradictionMisses: 0 },
  });
  const risky = evaluateResearchPolicyCandidate({
    candidate: {
      sourceGroundingWeight: 0.8,
      contradictionCheckWeight: 0.5,
      figureEvidencePenalty: 0.3,
      status: 'shadow_only',
    },
    researchCase: { supportedClaims: 1, unsupportedClaims: 3, figureOnlyClaims: 2, contradictionMisses: 1 },
  });

  assert.equal(grounded.score > risky.score, true);
  assert.equal(grounded.reasons.includes('source_grounded_evidence_rewarded'), true);
  assert.equal(risky.reasons.includes('figure_only_evidence_penalized'), true);
  assert.equal(risky.reasons.includes('contradiction_miss_penalized'), true);
});

test('novelty controls carry optional research policy metadata', () => {
  const controls = assessNoveltyAndRisk({
    claims: [{ claimId: 'figure_only', evidence: [{ figureId: 'fig1' }] }],
    figureCandidates: [{ figureId: 'fig1' }],
    researchPolicy: { policyId: 'research_shadow', status: 'shadow_only' },
  });

  assert.deepEqual(controls.policy, { policyId: 'research_shadow', status: 'shadow_only', mode: 'metadata_only' });
});
