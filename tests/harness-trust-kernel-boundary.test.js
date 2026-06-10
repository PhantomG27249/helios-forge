import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateTrustKernelBoundary } from '../src/harness-sidecar/core/trustKernelBoundary.js';

test('rejects verifier policy floor weakening', () => {
  const decision = evaluateTrustKernelBoundary({
    proposal: { kind: 'verifier_policy', changes: { minVerifierPasses: 0 } },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'verifier_floor_weakened');
});

test('rejects global path mutation outside workspace', () => {
  const decision = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    proposal: {
      kind: 'source_patch',
      requestedBy: 'local_meta_harness',
      paths: ['C:/Users/jackj/.codex/skills/global/SKILL.md'],
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'path_outside_workspace');
});

test('requires explicit approval for global meta harness source patches inside workspace', () => {
  const decision = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    proposal: {
      kind: 'source_patch',
      requestedBy: 'global_meta_harness',
      paths: ['src/harness-sidecar/meta/promotionLoop.js'],
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresApproval, true);
});

test('does not trust approval embedded in optimizer proposal payload', () => {
  const decision = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    proposal: {
      kind: 'source_patch',
      paths: ['src/harness-sidecar/meta/promotionLoop.js'],
      approval: { approved: true },
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresApproval, true);
});

test('rejects source patches without explicit target paths', () => {
  const decision = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    approved: true,
    proposal: {
      kind: 'source_patch',
      patch: 'diff --git a/C:/Users/jackj/.codex/skills/global/SKILL.md b/C:/Users/jackj/.codex/skills/global/SKILL.md',
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'missing_patch_paths');
});

test('rejects source patches without paths even without workspace root', () => {
  const decision = evaluateTrustKernelBoundary({
    approved: true,
    proposal: {
      kind: 'source_patch',
      patch: 'diff --git a/foo b/foo',
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'missing_patch_paths');
});

test('rejects top-level audit and secret redaction disables', () => {
  const audit = evaluateTrustKernelBoundary({
    proposal: { kind: 'policy', auditEnabled: false },
  });
  const secrets = evaluateTrustKernelBoundary({
    proposal: { kind: 'policy', redactSecrets: false },
  });

  assert.equal(audit.allowed, false);
  assert.equal(audit.reason, 'audit_disable_rejected');
  assert.equal(secrets.allowed, false);
  assert.equal(secrets.reason, 'secret_redaction_disable_rejected');
});

test('requires artifact-backed visual evidence for visual task source patches', () => {
  const blocked = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    approved: true,
    proposal: {
      kind: 'source_patch',
      taskKind: 'visual',
      paths: ['public/app.css'],
      visualEvidenceRequired: true,
      visualEvidence: {
        nodes: [{ id: 'visual_evidence:task_visual:metadata', type: 'visual_evidence' }],
        artifacts: [],
        verdict: { passed: true },
      },
    },
  });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'missing_visual_evidence');
  assert.equal(blocked.requiresApproval, true);

  const artifactWithoutVerdict = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    approved: true,
    proposal: {
      kind: 'source_patch',
      taskKind: 'visual',
      paths: ['public/app.css'],
      visualEvidenceRequired: true,
      visualEvidence: {
        artifacts: [{ type: 'screenshot', path: '.harness/visual/task_visual/after.png' }],
      },
    },
  });

  assert.equal(artifactWithoutVerdict.allowed, false);
  assert.equal(artifactWithoutVerdict.reason, 'missing_visual_evidence');

  const allowedWithApproval = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    approved: true,
    proposal: {
      kind: 'source_patch',
      taskKind: 'visual',
      paths: ['public/app.css'],
      visualEvidenceRequired: true,
      visualEvidence: {
        nodes: [{
          id: 'visual_evidence:task_visual:screenshot',
          type: 'visual_evidence',
          path: '.harness/visual/task_visual/after.png',
          artifactHash: 'sha256:abc123',
        }],
        artifacts: [{
          type: 'screenshot',
          path: '.harness/visual/task_visual/after.png',
          hash: 'sha256:abc123',
        }],
        verdict: { passed: true, score: 0.91, confidence: 0.8 },
      },
    },
  });

  assert.equal(allowedWithApproval.allowed, true);
  assert.equal(allowedWithApproval.reason, null);
});

test('requires hash-backed positive visual evidence for visual-impacting source patches', () => {
  const missingHash = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    approved: true,
    proposal: {
      kind: 'source_patch',
      visualImpact: true,
      paths: ['public/app.css'],
      visualEvidence: {
        artifacts: [{ type: 'screenshot', path: '.harness/visual/task_visual/after.png' }],
        verdict: { passed: true, score: 0.94, confidence: 0.82 },
      },
    },
  });

  assert.equal(missingHash.allowed, false);
  assert.equal(missingHash.reason, 'missing_visual_evidence_hash');
  assert.equal(missingHash.requiresApproval, true);

  const failedVerdict = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    approved: true,
    proposal: {
      kind: 'source_patch',
      visualImpact: true,
      paths: ['public/app.css'],
      visualEvidence: {
        artifacts: [{
          type: 'screenshot',
          path: '.harness/visual/task_visual/after.png',
          hash: 'sha256:abc123',
        }],
        verdict: { passed: false, score: 0.94, confidence: 0.82 },
      },
    },
  });

  assert.equal(failedVerdict.allowed, false);
  assert.equal(failedVerdict.reason, 'missing_visual_evidence');

  const allowed = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    approved: true,
    proposal: {
      kind: 'source_patch',
      visualImpact: true,
      paths: ['public/app.css'],
      visualEvidence: {
        nodes: [{
          id: 'visual_evidence:task_visual:screenshot',
          type: 'visual_evidence',
          path: '.harness/visual/task_visual/after.png',
          artifactHash: 'sha256:abc123',
        }],
        artifacts: [{
          type: 'screenshot',
          path: '.harness/visual/task_visual/after.png',
          hash: 'sha256:abc123',
        }],
        verdict: { passed: true, score: 0.94, confidence: 0.82 },
      },
    },
  });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, null);
});

test('rejects partial visual evidence when any path-backed reference is missing a hash', () => {
  const result = evaluateTrustKernelBoundary({
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
    approved: true,
    proposal: {
      kind: 'source_patch',
      visualImpact: true,
      paths: ['public/app.css'],
      visualEvidence: {
        nodes: [{
          id: 'visual_evidence:task_visual:screenshot',
          type: 'visual_evidence',
          path: '.harness/visual/task_visual/after.png',
          artifactHash: 'sha256:abc123',
        }],
        artifacts: [
          {
            type: 'screenshot',
            path: '.harness/visual/task_visual/after.png',
            hash: 'sha256:abc123',
          },
          {
            type: 'diff',
            path: '.harness/visual/task_visual/diff.png',
          },
        ],
        verdict: { passed: true, score: 0.94, confidence: 0.82 },
      },
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'missing_visual_evidence_hash');
});
