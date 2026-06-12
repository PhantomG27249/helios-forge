import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { executeApprovedApplyAction } from '../src/harness-sidecar/core/approvalResume.js';
import { evaluateTrustKernelBoundary } from '../src/harness-sidecar/core/trustKernelBoundary.js';
import { decideAutoApproval } from '../src/harness-sidecar/meta/autoApprovalPolicy.js';
import { decideGovernanceAction } from '../src/harness-sidecar/meta/governanceLoop.js';
import { evaluateProductionAutonomy } from '../src/harness-sidecar/meta/productionAutonomyPolicy.js';
import { evaluatePromotion } from '../src/harness-sidecar/meta/promotionPolicy.js';
import { applyVerifierConfigCandidate } from '../src/harness-sidecar/tools/verifierConfigApply.js';

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
    heldOutPassed: true,
    baselinePassed: true,
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

async function makeWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-authority-boundary-'));
  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  await writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }), 'utf8');
  await writeFile(path.join(workspaceRoot, '.harness', 'verifiers.json'), JSON.stringify({ version: 1, verifiers: [] }), 'utf8');
  return workspaceRoot;
}

test('production autonomy cannot weaken verifier floors across promotion and trust boundary checks', () => {
  const autonomy = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'vg-floor-zero',
      candidateType: 'verifier',
      risk: 'low',
      changes: { minVerifierPasses: 0 },
    },
    evidence: completeEvidence(),
    operatorPolicy: enabledPolicy,
  });
  const boundary = evaluateTrustKernelBoundary({
    proposal: {
      kind: 'verifier_policy',
      changes: { minVerifierPasses: 0 },
    },
  });
  const promotion = evaluatePromotion({
    candidateRun: {
      candidateId: 'vg-floor-zero',
      target: 'verifier_policy',
      verifierGenome: { genomeId: 'vg-floor-zero' },
      metrics: {
        falsePositive: 0,
        falseNegative: 0,
        recall: 1,
        safetyPassed: true,
        flakiness: 0,
      },
      evidence: completeEvidence(),
      rollback: { reversible: true },
      productionAutonomy: autonomy,
    },
    baselineVerifierMetrics: { falsePositive: 1, falseNegative: 1, recall: 0.5 },
    approvals: [{ candidateId: 'vg-floor-zero', choice: 'approve' }],
    productionAutonomy: autonomy,
  });

  assert.equal(autonomy.promotionEligible, false);
  assert.equal(autonomy.blockers.includes('verifier_floor_weakened'), true);
  assert.equal(boundary.allowed, false);
  assert.equal(boundary.reason, 'verifier_floor_weakened');
  assert.equal(promotion.status, 'rejected');
  assert.equal(promotion.reasons.includes('production_autonomy_blocked'), true);
});

test('low-risk approval narrowing remains metadata and cannot bypass approved apply paths', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const autonomy = evaluateProductionAutonomy({
      candidate: {
        candidateId: 'local-config',
        candidateType: 'config',
        risk: 'low',
        changeType: 'local_config',
        writeScope: 'workspace_local',
      },
      evidence: completeEvidence(),
      operatorPolicy: enabledPolicy,
    });
    const autoApproval = decideAutoApproval({
      candidate: { candidateId: 'local-config', changeType: 'local_config' },
      evidence: { heldOutPassed: true, baselinePassed: true },
      rollback: { reversible: true },
    });
    const governance = decideGovernanceAction({
      autonomyLevel: 3,
      candidate: { candidateId: 'local-config', changeType: 'local_config', risk: 'low' },
      evidence: { heldOutPassed: true, baselinePassed: true },
      rollback: { reversible: true },
      policy: { productionAutonomy: autonomy },
    });
    const applyResult = await executeApprovedApplyAction({
      workspaceRoot,
      approved: false,
      action: {
        actionId: 'act-local-config',
        taskId: 'task-local-config',
        kind: 'verifier_config_apply',
        payload: {
          candidate: {
            candidateId: 'local-config',
            verifier: { name: 'local-config-verifier', tool: 'visual.verifier.run' },
          },
        },
      },
    });

    assert.equal(autonomy.approvalNarrowing.eligible, true);
    assert.equal(autonomy.canApply, false);
    assert.equal(autoApproval.status, 'auto_approved');
    assert.equal(governance.productionAutonomy.canApply, false);
    assert.equal(applyResult.status, 'rejected');
    assert.equal(applyResult.reason, 'approval_required');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('governance escalates instead of auto-approving when production autonomy has blockers', () => {
  const candidate = {
    candidateId: 'local-config-blocked',
    candidateType: 'config',
    risk: 'low',
    changeType: 'local_config',
    writeScope: 'workspace_local',
    visualImpact: true,
  };
  const evidence = completeEvidence({
    visual: {
      external: true,
      verified: true,
      verdict: { passed: true },
      artifacts: [{ path: '.harness/visual/external-after.png', hash: 'sha256:abc' }],
    },
  });
  const productionAutonomy = evaluateProductionAutonomy({
    candidate,
    evidence,
    operatorPolicy: {
      ...enabledPolicy,
      visualEvidence: { requireVlmForVisualImpact: true },
    },
  });

  const governance = decideGovernanceAction({
    autonomyLevel: 3,
    candidate,
    evidence: { heldOutPassed: true, baselinePassed: true },
    rollback: { reversible: true },
    policy: { productionAutonomy },
  });

  assert.equal(productionAutonomy.promotionEligible, false);
  assert.equal(productionAutonomy.canApply, false);
  assert.equal(productionAutonomy.blockers.includes('missing_vlm_visual_evidence'), true);
  assert.equal(governance.decision, 'escalated');
  assert.equal(governance.reasons.includes('production_autonomy_blocked'), true);
  assert.equal(governance.reasons.includes('missing_vlm_visual_evidence'), true);
  assert.equal(governance.auditEvent.type, 'governance.escalation');
});

test('governance evaluates top-level production autonomy gate before auto-approval', () => {
  const governance = decideGovernanceAction({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'local-config-top-level-gate',
      candidateType: 'config',
      risk: 'low',
      changeType: 'local_config',
      writeScope: 'workspace_local',
      visualImpact: true,
    },
    evidence: {
      heldOutPassed: true,
      baselinePassed: true,
      rollback: { reversible: true },
    },
    rollback: { reversible: true },
    policy: {
      productionAutonomyPolicy: {
        enabled: true,
        mode: 'advisory',
        authority: 'evidence_only',
      },
      visualEvidence: { requireVlmForVisualImpact: true },
    },
  });

  assert.equal(governance.decision, 'escalated');
  assert.equal(governance.productionAutonomy.promotionEligible, false);
  assert.equal(governance.productionAutonomy.canApply, false);
  assert.equal(governance.reasons.includes('production_autonomy_blocked'), true);
  assert.equal(governance.reasons.includes('missing_vlm_visual_evidence'), true);
});

test('governance passes separate rollback evidence into top-level production autonomy evaluation', () => {
  const governance = decideGovernanceAction({
    autonomyLevel: 3,
    candidate: {
      candidateId: 'local-config-separate-rollback',
      candidateType: 'config',
      risk: 'low',
      changeType: 'local_config',
      writeScope: 'workspace_local',
    },
    evidence: {
      heldOutPassed: true,
      baselinePassed: true,
      rollback: {},
    },
    rollback: {
      reversible: true,
      drillId: 'rollback-separate-1',
      restoreVerified: true,
      artifacts: [{ artifactId: 'rollback-log', path: '.harness/rollback/log.json', hash: 'sha256:rollback' }],
    },
    policy: {
      productionAutonomyPolicy: {
        enabled: true,
        mode: 'advisory',
        authority: 'evidence_only',
      },
    },
  });

  assert.equal(governance.decision, 'escalated');
  assert.equal(governance.productionAutonomy.rollbackPolicy.available, true);
  assert.equal(governance.productionAutonomy.blockers.includes('rollback_required'), false);
  assert.equal(governance.reasons.includes('rollback_required'), false);
});

test('external evidence is quarantined and cannot become verified through policy evaluation', () => {
  const externalEvidence = {
    externalA2A: {
      external: true,
      verified: true,
      source: 'remote-peer',
      promoted: true,
      canPromote: true,
      approvalAuthority: true,
    },
  };

  const result = evaluateProductionAutonomy({
    candidate: { candidateId: 'a2a-claim', candidateType: 'a2a_transport', risk: 'medium' },
    evidence: completeEvidence(externalEvidence),
    operatorPolicy: enabledPolicy,
  });

  assert.equal(result.evidencePolicy.externalA2A.verified, false);
  assert.equal(result.evidencePolicy.externalA2A.canPromote, false);
  assert.equal(result.evidencePolicy.externalA2A.promoted, false);
  assert.equal(result.quarantine.reasons.includes('external_verification_escalation'), true);
  assert.equal(result.promotionEligible, false);
});

test('safe verifier config apply still requires explicit approval after autonomy evaluation', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const autonomy = evaluateProductionAutonomy({
      candidate: { candidateId: 'vg-safe', candidateType: 'verifier', risk: 'medium' },
      evidence: completeEvidence(),
      operatorPolicy: enabledPolicy,
    });
    const rejected = await applyVerifierConfigCandidate({
      workspaceRoot,
      candidate: {
        candidateId: 'vg-safe',
        verifier: { name: 'safe-verifier', tool: 'visual.verifier.run' },
      },
      approval: { approved: autonomy.canApply },
    });
    const config = JSON.parse(await readFile(path.join(workspaceRoot, '.harness', 'verifiers.json'), 'utf8'));

    assert.equal(autonomy.canApply, false);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.reason, 'approval_required');
    assert.deepEqual(config.verifiers, []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
