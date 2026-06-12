import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateProductionAutonomy } from '../src/harness-sidecar/meta/productionAutonomyPolicy.js';
import { runRollbackDrill } from '../src/harness-sidecar/meta/rollbackDrillRunner.js';

const enabledPolicy = {
  productionCapabilities: {
    productionAutonomyPolicy: {
      enabled: true,
      mode: 'advisory',
      authority: 'evidence_only',
    },
  },
};

test('rollback drill runner records restore verification and artifacts as evidence only', async () => {
  const drill = await runRollbackDrill({
    candidate: { candidateId: 'config-rollback' },
    captureBefore: async () => ({ snapshotId: 'before-1' }),
    applyCandidate: async () => ({ applied: true }),
    rollbackCandidate: async () => ({ rolledBack: true }),
    verifyRestore: async () => true,
    recordArtifact: async () => ({ artifactId: 'rollback-log', path: '.harness/rollback/log.json', hash: 'sha256:abc' }),
    now: () => new Date('2026-06-12T18:00:00.000Z'),
  });

  assert.equal(drill.status, 'passed');
  assert.equal(drill.rollbackVerified, true);
  assert.equal(drill.restoreVerified, true);
  assert.equal(drill.artifacts.length, 1);
  assert.equal(drill.evidenceOnly, true);
  assert.equal(drill.canPromote, false);
  assert.equal(drill.canApply, false);
  assert.equal(drill.authority, 'evidence_only');
});

test('rollback drill runner fails when restore verification or artifacts are missing', async () => {
  const missingArtifact = await runRollbackDrill({
    candidate: { candidateId: 'missing-artifact' },
    verifyRestore: async () => true,
    now: () => new Date('2026-06-12T18:05:00.000Z'),
  });
  const failedRestore = await runRollbackDrill({
    candidate: { candidateId: 'failed-restore' },
    recordArtifact: async () => ({ artifactId: 'rollback-log', path: '.harness/rollback/log.json', hash: 'sha256:def' }),
    verifyRestore: async () => false,
    now: () => new Date('2026-06-12T18:10:00.000Z'),
  });

  assert.equal(missingArtifact.status, 'failed');
  assert.equal(missingArtifact.blockers.includes('rollback_artifact_required'), true);
  assert.equal(failedRestore.status, 'failed');
  assert.equal(failedRestore.blockers.includes('restore_verification_failed'), true);
});

test('rollback drill runner turns adapter errors and unsafe artifacts into failed evidence', async () => {
  const drill = await runRollbackDrill({
    candidate: { candidateId: 'unsafe-artifact' },
    applyCandidate: async () => {
      throw new Error('token=sk-adapter-secret');
    },
    recordArtifact: async () => ({ artifactId: 'unsafe', path: 'C:\\Users\\jackj\\secret.log', hash: 'sha256:unsafe' }),
    verifyRestore: async () => true,
  });
  const visible = JSON.stringify(drill);

  assert.equal(drill.status, 'failed');
  assert.equal(drill.blockers.includes('rollback_error'), true);
  assert.equal(drill.blockers.includes('rollback_artifact_required'), true);
  assert.equal(visible.includes('sk-adapter-secret'), false);
  assert.equal(visible.includes('C:\\Users'), false);
});

test('passing rollback drill satisfies rollback evidence but never grants apply authority', async () => {
  const drill = await runRollbackDrill({
    candidate: { candidateId: 'config-safe' },
    recordArtifact: async () => ({ artifactId: 'rollback-log', path: '.harness/rollback/log.json', hash: 'sha256:abc' }),
    verifyRestore: async () => true,
  });
  const autonomy = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'config-safe',
      candidateType: 'config',
      risk: 'low',
      changeType: 'local_config',
      writeScope: 'workspace_local',
    },
    evidence: { rollback: drill },
    operatorPolicy: enabledPolicy,
  });

  assert.equal(autonomy.rollbackPolicy.available, true);
  assert.equal(autonomy.approvalNarrowing.eligible, true);
  assert.equal(autonomy.canApply, false);
  assert.equal(autonomy.directApplyAllowed, false);
});

test('failed rollback drills do not satisfy production rollback evidence', async () => {
  const drill = await runRollbackDrill({
    candidate: { candidateId: 'config-failed' },
    recordArtifact: async () => ({ artifactId: 'rollback-log', path: '.harness/rollback/log.json', hash: 'sha256:abc' }),
    verifyRestore: async () => false,
  });
  const autonomy = evaluateProductionAutonomy({
    candidate: {
      candidateId: 'config-failed',
      candidateType: 'config',
      risk: 'low',
      changeType: 'local_config',
      writeScope: 'workspace_local',
    },
    evidence: { rollback: drill },
    operatorPolicy: enabledPolicy,
  });

  assert.equal(drill.status, 'failed');
  assert.equal(drill.restoreVerified, false);
  assert.equal(autonomy.rollbackPolicy.available, false);
  assert.equal(autonomy.blockers.includes('rollback_required'), true);
  assert.equal(autonomy.promotionEligible, false);
});
