import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateProductionAutonomy } from '../src/harness-sidecar/meta/productionAutonomyPolicy.js';

const enabledPolicy = {
  productionCapabilities: {
    productionAutonomyPolicy: {
      enabled: true,
      mode: 'advisory',
      authority: 'evidence_only',
    },
  },
};

function completeEvidence(overrides = {}) {
  return {
    replay: { passed: true },
    verifier: { passed: true },
    provenance: { traceId: 'trace-1' },
    rollback: { reversible: true, drillId: 'rollback-1' },
    ...overrides,
  };
}

test('production autonomy gate defaults to disabled evidence-only advisory state', () => {
  const result = evaluateProductionAutonomy({
    candidate: { candidateId: 'docs-1', candidateType: 'docs', risk: 'low' },
    evidence: completeEvidence(),
    operatorPolicy: {},
  });

  assert.equal(result.gate.enabled, false);
  assert.equal(result.authority, 'evidence_only');
  assert.equal(result.promotionEligible, false);
  assert.equal(result.canApply, false);
  assert.equal(result.reasons.includes('production_autonomy_policy_disabled'), true);
});

test('classifies production autonomy requirements for expected candidate types', () => {
  const expected = [
    ['docs', 'documentation_change', 1],
    ['config', 'configuration_change', 2],
    ['prompt', 'prompt_policy_change', 2],
    ['skill', 'skill_policy_change', 2],
    ['verifier', 'verifier_policy_change', 0],
    ['code', 'source_code_change', 0],
    ['model_routing', 'model_routing_change', 1],
    ['a2a_transport', 'external_transport_change', 0],
    ['visual_policy', 'visual_policy_change', 0],
    ['memory_policy', 'memory_policy_change', 0],
  ];

  for (const [candidateType, normalizedType, maxAutonomyLevel] of expected) {
    const result = evaluateProductionAutonomy({
      candidate: {
        candidateId: `candidate-${candidateType}`,
        candidateType,
        risk: 'low',
      },
      evidence: completeEvidence({
        visual: { verdict: { passed: true }, artifacts: [{ path: '.harness/visual/after.png', hash: 'sha256:abc' }] },
      }),
      operatorPolicy: enabledPolicy,
    });

    assert.equal(result.candidateType, normalizedType);
    assert.equal(result.maxAutonomyLevel, maxAutonomyLevel);
    assert.equal(result.authority, 'evidence_only');
    assert.equal(result.canApply, false);
  }
});

test('low-risk approval narrowing is eligibility-only and never direct apply authority', () => {
  const result = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'config-low-risk',
      candidateType: 'config',
      risk: 'low',
      changeType: 'local_config',
      writeScope: 'workspace_local',
    },
    evidence: completeEvidence(),
    operatorPolicy: enabledPolicy,
  });

  assert.equal(result.approvalNarrowing.eligible, true);
  assert.equal(result.approvalNarrowing.tier, 'low_risk_reversible_local');
  assert.equal(result.promotionEligible, true);
  assert.equal(result.requiresHumanApproval, false);
  assert.equal(result.canApply, false);
  assert.equal(result.reasons.includes('approval_narrowing_eligibility_only'), true);
});

test('high-risk changes always require human approval and escalation', () => {
  const result = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'code-high-risk',
      candidateType: 'code',
      risk: 'high',
      changeType: 'source_patch',
    },
    evidence: completeEvidence(),
    operatorPolicy: enabledPolicy,
  });

  assert.equal(result.requiresHumanApproval, true);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.escalation.required, true);
  assert.equal(result.reasons.includes('high_risk_requires_human'), true);
});

test('external A2A evidence policy blocks unverified external promotion and keeps claims unverified', () => {
  const result = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'a2a-prod',
      candidateType: 'a2a_transport',
      risk: 'medium',
    },
    evidence: completeEvidence({
      externalA2A: {
        external: true,
        verified: true,
        source: 'remote-peer',
        claim: { canPromote: true, approved: true },
      },
    }),
    operatorPolicy: {
      ...enabledPolicy,
      externalEvidence: { allowUnverifiedA2A: false },
    },
  });

  assert.equal(result.promotionEligible, false);
  assert.equal(result.evidencePolicy.externalA2A.verified, false);
  assert.equal(result.blockers.includes('external_a2a_unverified'), true);
  assert.equal(result.quarantine.quarantined, true);
  assert.equal(result.quarantine.reasons.includes('external_verification_escalation'), true);
});

test('VLM-required policy blocks visual-impacting candidates without hash-backed visual evidence', () => {
  const missingVisual = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'visual-policy-1',
      candidateType: 'visual_policy',
      risk: 'medium',
      visualImpact: true,
    },
    evidence: completeEvidence(),
    operatorPolicy: {
      ...enabledPolicy,
      visualEvidence: { requireVlmForVisualImpact: true },
    },
  });

  const completeVisual = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'visual-policy-2',
      candidateType: 'visual_policy',
      risk: 'medium',
      visualImpact: true,
    },
    evidence: completeEvidence({
      visual: {
        verdict: { passed: true },
        artifacts: [{ path: '.harness/visual/after.png', hash: 'sha256:abc' }],
      },
    }),
    operatorPolicy: {
      ...enabledPolicy,
      visualEvidence: { requireVlmForVisualImpact: true },
    },
  });

  assert.equal(missingVisual.promotionEligible, false);
  assert.equal(missingVisual.blockers.includes('missing_vlm_visual_evidence'), true);
  assert.equal(completeVisual.blockers.includes('missing_vlm_visual_evidence'), false);
});

test('quarantined external VLM evidence cannot satisfy VLM-required promotion gate', () => {
  const result = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'config-external-vlm',
      candidateType: 'config',
      risk: 'low',
      changeType: 'local_config',
      writeScope: 'workspace_local',
      visualImpact: true,
    },
    evidence: completeEvidence({
      visual: {
        external: true,
        verified: true,
        verdict: { passed: true },
        artifacts: [{ path: '.harness/visual/external-after.png', hash: 'sha256:abc' }],
      },
    }),
    operatorPolicy: {
      ...enabledPolicy,
      visualEvidence: { requireVlmForVisualImpact: true },
    },
  });

  assert.equal(result.evidencePolicy.vlmEvidenceSatisfied, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.blockers.includes('missing_vlm_visual_evidence'), true);
  assert.equal(result.quarantine.reasons.includes('external_verification_escalation'), true);
});

test('quarantined rollback evidence cannot satisfy rollback requirements', () => {
  const result = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'config-unsafe-rollback',
      candidateType: 'config',
      risk: 'low',
      changeType: 'local_config',
      writeScope: 'workspace_local',
    },
    evidence: completeEvidence({
      rollback: {
        drillId: 'C:/Users/jackj/.ssh/id_rsa',
      },
    }),
    operatorPolicy: enabledPolicy,
  });

  assert.equal(result.quarantine.redacted, true);
  assert.equal(result.quarantine.reasons.includes('unsafe_path_value'), true);
  assert.equal(result.rollbackPolicy.available, false);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.blockers.includes('rollback_required'), true);
});

test('override approval is audited but remains non-authoritative without rollback evidence', () => {
  const result = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'memory-policy-override',
      candidateType: 'memory_policy',
      risk: 'medium',
    },
    evidence: completeEvidence({ rollback: { reversible: false } }),
    operatorPolicy: enabledPolicy,
    risk: {
      override: { approvedBy: 'operator', reason: 'emergency pause' },
    },
  });

  assert.equal(result.overrideAudit.required, true);
  assert.equal(result.overrideAudit.approvedBy, 'operator');
  assert.equal(result.promotionEligible, false);
  assert.equal(result.blockers.includes('rollback_required'), true);
  assert.equal(result.canApply, false);
});
