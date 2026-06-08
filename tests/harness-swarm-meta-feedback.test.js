import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BesMetaOptimizer } from '../src/harness-sidecar/meta/besMetaOptimizer.js';
import { buildRhoCoreset } from '../src/harness-sidecar/rho/coresetBuilder.js';
import { summarizeSwarmOutcome } from '../src/harness-sidecar/swarm/swarmOutcomeRecorder.js';

test('swarm outcome recorder promotes champion success into positive signals', () => {
  const summary = summarizeSwarmOutcome({
    taskId: 'task_swarm_feedback',
    attempts: [
      {
        attemptId: 'attempt_1',
        strategy: 'minimal_patch',
        status: 'completed',
        verifierPassed: true,
        verifierEvidence: ['node --test focused'],
        score: 92,
      },
    ],
    champion: { attemptId: 'attempt_1', score: 92, verifierPassed: true },
  });

  assert.equal(summary.positiveSignals.length, 1);
  assert.equal(summary.positiveSignals[0].attemptId, 'attempt_1');
  assert.equal(summary.positiveSignals[0].reason, 'swarm_champion_success');
  assert.deepEqual(summary.metaCandidates[0].failureModes, ['swarm_recombination_win']);
});

test('swarm outcome recorder turns rejected unsafe and missing-verifier attempts into hard cases', () => {
  const summary = summarizeSwarmOutcome({
    taskId: 'task_swarm_hard_cases',
    attempts: [
      {
        attemptId: 'attempt_missing',
        status: 'completed',
        verifierPassed: false,
        verifierEvidence: [],
        score: 65,
      },
      {
        attemptId: 'attempt_unsafe',
        status: 'completed',
        verifierPassed: true,
        verifierEvidence: ['smoke'],
        safety: 'unsafe',
        risks: ['secret_exposure'],
      },
      {
        attemptId: 'attempt_visual',
        status: 'failed',
        profile: { id: 'visual-specialist' },
        failure: { reason: 'vlm_artifact_missing' },
        artifacts: [{ kind: 'screenshot', path: 'screen.png' }],
      },
    ],
    reviews: [
      { attemptId: 'attempt_missing', approved: false, reasons: ['missing_verifier_evidence'] },
      { attemptId: 'attempt_unsafe', approved: false, reasons: ['unsafe_patch'] },
      { attemptId: 'attempt_visual', approved: false, reasons: ['visual_failure'] },
    ],
  });

  assert.deepEqual(
    summary.hardCases.map((item) => item.failureModes[0]),
    ['swarm_missing_verifier_evidence', 'swarm_unsafe_patch', 'swarm_visual_failure'],
  );
  assert.deepEqual(summary.failureModes, [
    'swarm_missing_verifier_evidence',
    'swarm_unsafe_patch',
    'swarm_visual_failure',
  ]);
  assert.equal(summary.visualCases.length, 1);
  assert.equal(summary.visualCases[0].attemptId, 'attempt_visual');
});

test('RHO selects swarm outcome hard cases with explicit reasons', () => {
  const summary = summarizeSwarmOutcome({
    taskId: 'task_swarm_rho',
    attempts: [{ attemptId: 'attempt_missing', verifierEvidence: [], verifierPassed: false }],
    reviews: [{ attemptId: 'attempt_missing', approved: false, reasons: ['missing_verifier_evidence'] }],
  });
  const coreset = buildRhoCoreset({ traces: summary.hardCases, limit: 4 });

  assert.equal(coreset.selectedCount, 1);
  assert.equal(coreset.items[0].taskId, 'task_swarm_rho:attempt_missing');
  assert.equal(coreset.items[0].reasons.includes('swarm_missing_verifier_evidence'), true);
});

test('BES meta optimizer consumes swarm hard-case reasons from RHO items', () => {
  const optimizer = new BesMetaOptimizer({
    now: () => new Date('2026-06-08T15:00:00.000Z'),
    idPrefix: 'swarm_feedback',
    maxCandidates: 1,
  });
  const result = optimizer.propose({
    traceSummary: { failureModes: [] },
    target: 'runtime_policy',
    coreset: {
      items: [{
        taskId: 'task_swarm_rho:attempt_missing',
        reasons: ['swarm_missing_verifier_evidence'],
      }],
    },
  });

  assert.match(result.candidates[0].rationale, /swarm_missing_verifier_evidence/);
});
