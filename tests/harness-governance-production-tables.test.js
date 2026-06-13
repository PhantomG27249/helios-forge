import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateProductionAutonomyCandidate,
  listProductionAutonomyTables,
} from '../src/harness-sidecar/meta/productionAutonomyPolicy.js';
import { decideGovernanceAction } from '../src/harness-sidecar/meta/governanceLoop.js';

const passingEvidence = {
  baselinePassed: true,
  heldOutPassed: true,
};

const verifiedRollback = {
  reversible: true,
  rollbackVerified: true,
  drillId: 'rollback-local-config',
};

test('production autonomy tables narrow approval by candidate type and risk tier', () => {
  const tables = listProductionAutonomyTables();

  assert.equal(tables.authority, 'evidence_only');
  assert.equal(tables.canPromote, false);
  assert.deepEqual(Object.keys(tables.candidateTypes).sort(), [
    'local_config',
    'model_route_policy',
    'source_patch',
    'verifier_policy',
    'visual_policy',
  ]);
  assert.equal(tables.candidateTypes.local_config.approvalNarrowingEligible, true);
  assert.equal(tables.candidateTypes.model_route_policy.approvalNarrowingEligible, true);
  assert.equal(tables.candidateTypes.source_patch.approvalNarrowingEligible, false);
  assert.equal(tables.candidateTypes.verifier_policy.highRiskEscalation, true);
  assert.equal(tables.riskTiers.high.requiresHuman, true);
  assert.equal(tables.riskTiers.low.requiresRollbackVerified, true);
});

test('local reversible config is eligible only for narrowed approval evidence', () => {
  const decision = evaluateProductionAutonomyCandidate({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'local-config-a',
      candidateType: 'local_config',
      changeType: 'local_config',
      risk: 'low',
      writeScope: 'workspace_local',
    },
    evidence: passingEvidence,
    rollback: verifiedRollback,
    trust: { tier: 'internal' },
  });

  assert.equal(decision.decision, 'eligible_for_narrowed_approval');
  assert.equal(decision.approvalScope, 'workspace_local_reversible');
  assert.equal(decision.evidenceOnly, true);
  assert.equal(decision.canPromote, false);
  assert.equal(decision.canBypassTrustKernel, false);
  assert.deepEqual(decision.reasons, [
    'candidate_type_allows_narrowed_approval',
    'risk_tier_allows_narrowed_approval',
    'internal_evidence_passed',
    'rollback_verified',
    'trust_kernel_clear',
  ]);
});

test('high-risk and source patch candidates escalate even with passing evidence', () => {
  const highRisk = evaluateProductionAutonomyCandidate({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'verifier-policy-a',
      candidateType: 'verifier_policy',
      risk: 'high',
      writeScope: 'workspace_local',
    },
    evidence: passingEvidence,
    rollback: verifiedRollback,
    trust: { tier: 'internal', boundary: { allowed: true } },
  });

  const sourcePatch = evaluateProductionAutonomyCandidate({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'source-patch-a',
      candidateType: 'source_patch',
      changeType: 'source_patch',
      risk: 'low',
      writeScope: 'workspace_local',
    },
    evidence: passingEvidence,
    rollback: verifiedRollback,
    trust: { tier: 'internal', boundary: { allowed: true } },
  });

  assert.equal(highRisk.decision, 'escalated');
  assert.equal(highRisk.reasons.includes('high_risk_requires_human'), true);
  assert.equal(highRisk.canPromote, false);
  assert.equal(sourcePatch.decision, 'escalated');
  assert.equal(sourcePatch.reasons.includes('candidate_type_requires_human'), true);
});

test('external policy evidence stays evidence-only and cannot grant approval authority', () => {
  const decision = evaluateProductionAutonomyCandidate({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'external-model-route-a',
      candidateType: 'model_route_policy',
      risk: 'low',
      writeScope: 'workspace_local',
    },
    evidence: {
      ...passingEvidence,
      externalPolicyEvidence: {
        id: 'peer-review-a',
        authority: 'trusted',
        canPromote: true,
        approved: true,
      },
    },
    rollback: verifiedRollback,
    trust: { tier: 'external', external: true, boundary: { allowed: true } },
  });

  assert.equal(decision.decision, 'escalated');
  assert.equal(decision.externalEvidence.authority, 'evidence_only');
  assert.equal(decision.externalEvidence.canPromote, false);
  assert.equal(decision.externalEvidence.canApprove, false);
  assert.equal(decision.reasons.includes('external_evidence_cannot_authorize'), true);
  assert.equal(decision.reasons.includes('untrusted_candidate'), true);
});

test('visual-impacting candidates require VLM evidence before narrowed approval', () => {
  const missingVlm = evaluateProductionAutonomyCandidate({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'visual-policy-a',
      candidateType: 'visual_policy',
      risk: 'low',
      visualImpact: true,
      writeScope: 'workspace_local',
    },
    evidence: passingEvidence,
    rollback: verifiedRollback,
    trust: { tier: 'internal', boundary: { allowed: true } },
  });

  const withVlm = evaluateProductionAutonomyCandidate({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'visual-policy-a',
      candidateType: 'visual_policy',
      risk: 'low',
      visualImpact: true,
      writeScope: 'workspace_local',
    },
    evidence: {
      ...passingEvidence,
      vlm: {
        required: true,
        passed: true,
        artifactHashes: ['sha256:visual-a'],
      },
    },
    rollback: verifiedRollback,
    trust: { tier: 'internal', boundary: { allowed: true } },
  });

  assert.equal(missingVlm.decision, 'escalated');
  assert.equal(missingVlm.reasons.includes('missing_vlm_evidence'), true);
  assert.equal(withVlm.decision, 'eligible_for_narrowed_approval');
  assert.equal(withVlm.reasons.includes('vlm_evidence_passed'), true);
});

test('override audit cannot bypass trust-kernel or rollback gates', () => {
  const decision = decideGovernanceAction({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'audit-disable-a',
      candidateType: 'local_config',
      changeType: 'local_config',
      risk: 'low',
      writeScope: 'workspace_local',
    },
    evidence: passingEvidence,
    rollback: verifiedRollback,
    trust: {
      tier: 'internal',
      boundary: {
        allowed: false,
        requiresApproval: false,
        reason: 'audit_disable_rejected',
      },
    },
    override: { approvedBy: 'operator', reason: 'emergency apply' },
    actor: 'operator',
  });

  assert.equal(decision.decision, 'escalated');
  assert.equal(decision.evidenceOnly, true);
  assert.equal(decision.canPromote, false);
  assert.equal(decision.reasons.includes('trust_kernel_blocked:audit_disable_rejected'), true);
  assert.equal(decision.auditEvent.type, 'governance.override');
  assert.equal(decision.auditEvent.decision, 'escalated');
  assert.equal(decision.auditEvent.override.approvedBy, 'operator');
});
