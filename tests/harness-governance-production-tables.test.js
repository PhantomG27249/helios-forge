import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideGovernanceAction } from '../src/harness-sidecar/meta/governanceLoop.js';
import {
  evaluateProductionAutonomy,
  listProductionAutonomyCandidateTypes,
} from '../src/harness-sidecar/meta/productionAutonomyPolicy.js';

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
    rollback: {
      reversible: true,
      drillId: 'rollback-1',
      restoreVerified: true,
      artifacts: [{ artifactId: 'rollback-log', path: '.harness/rollback/log.json', hash: 'sha256:rollback' }],
    },
    ...overrides,
  };
}

test('production autonomy table exposes candidate types as evidence-only no-apply rows', () => {
  const rows = listProductionAutonomyCandidateTypes();
  const byType = new Map(rows.map((row) => [row.candidateType, row]));

  assert.equal(byType.get('configuration_change').maxAutonomyLevel, 2);
  assert.equal(byType.get('source_code_change').maxAutonomyLevel, 0);
  assert.equal(byType.get('external_transport_change').maxAutonomyLevel, 0);
  assert.equal(byType.get('visual_policy_change').visualEvidenceRequired, true);
  assert.equal(byType.get('configuration_change').aliases.includes('config'), true);
  assert.equal(byType.get('configuration_change').rollbackRequired, true);
  assert.equal(rows.every((row) => row.authority === 'evidence_only'), true);
  assert.equal(rows.every((row) => row.canApply === false), true);
  assert.equal(rows.every((row) => row.directApplyAllowed === false), true);
});

test('approval narrowing remains eligibility-only for local reversible config changes', () => {
  const result = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'config-low',
      candidateType: 'config',
      risk: 'low',
      writeScope: 'workspace_local',
      changeType: 'local_config',
    },
    evidence: completeEvidence(),
    operatorPolicy: enabledPolicy,
  });

  assert.equal(result.approvalNarrowing.eligible, true);
  assert.equal(result.approvalNarrowing.authority, 'eligibility_only');
  assert.equal(result.canApply, false);
  assert.equal(result.directApplyAllowed, false);
});

test('override audit does not hide blockers or bypass trust kernel authority', () => {
  const candidate = {
    candidateId: 'override-code',
    candidateType: 'code',
    risk: 'high',
    changeType: 'source_patch',
  };
  const productionAutonomy = evaluateProductionAutonomy({
    candidate,
    evidence: completeEvidence({ rollback: { reversible: false } }),
    operatorPolicy: enabledPolicy,
    risk: { override: { approvedBy: 'operator', reason: 'incident response' } },
  });
  const governance = decideGovernanceAction({
    autonomyLevel: 3,
    candidate,
    evidence: { heldOutPassed: true, baselinePassed: true },
    rollback: { reversible: false },
    policy: { productionAutonomy },
    override: { approvedBy: 'operator', reason: 'incident response' },
  });

  assert.equal(productionAutonomy.promotionEligible, false);
  assert.equal(productionAutonomy.blockers.includes('high_risk_requires_human'), true);
  assert.equal(productionAutonomy.blockers.includes('rollback_required'), true);
  assert.equal(productionAutonomy.overrideAudit.authority, 'audit_only');
  assert.equal(productionAutonomy.overrideAudit.trustKernelBypass, false);
  assert.equal(productionAutonomy.overrideAudit.canApply, false);
  assert.equal(governance.decision, 'override_audited');
  assert.equal(governance.productionAutonomy.canApply, false);
  assert.equal(governance.reasons.includes('high_risk_requires_human'), true);
  assert.equal(governance.auditEvent.override.trustKernelBypass, false);
});

test('external A2A and external VLM claims remain unverified after quarantine', () => {
  const result = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'external-visual',
      candidateType: 'visual_policy',
      risk: 'medium',
      visualImpact: true,
    },
    evidence: completeEvidence({
      externalA2A: { external: true, verified: true, claim: { canPromote: true } },
      visual: {
        external: true,
        verified: true,
        verdict: { passed: true },
        artifacts: [{ path: '.harness/visual/after.png', hash: 'sha256:abc' }],
      },
    }),
    operatorPolicy: {
      ...enabledPolicy,
      visualEvidence: { requireVlmForVisualImpact: true },
    },
  });

  assert.equal(result.evidencePolicy.externalA2A.verified, false);
  assert.equal(result.evidencePolicy.vlmEvidenceSatisfied, false);
  assert.equal(result.blockers.includes('external_a2a_unverified'), true);
  assert.equal(result.blockers.includes('missing_vlm_visual_evidence'), true);
});
