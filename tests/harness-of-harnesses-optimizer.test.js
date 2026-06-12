import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HarnessOfHarnessesOptimizer,
  createHarnessOfHarnessesOptimizer,
} from '../src/harness-sidecar/meta/harnessOfHarnessesOptimizer.js';

const targetOptimizers = ['rho', 'bes', 'meta', 'router', 'visual', 'memory'];

function assertEvidenceCandidate(candidate, targetOptimizer) {
  assert.equal(candidate.parentOptimizerId, 'meta-parent-001');
  assert.equal(candidate.targetOptimizer, targetOptimizer);
  assert.match(candidate.optimizerCandidateId, new RegExp(`^hoh_meta_parent_001_${targetOptimizer}_`));
  assert.equal(candidate.evidenceOnly, true);
  assert.equal(candidate.canPromote, false);
  assert.equal(candidate.evidence.kind, 'harness_of_harnesses_optimizer_evidence');
  assert.equal(candidate.evidence.targetOptimizer, targetOptimizer);
  assert.equal(candidate.evidence.parentOptimizerId, 'meta-parent-001');
  assert.equal(candidate.evidence.sourceEvidenceIds.includes(`${targetOptimizer}-heldout`), true);
  assert.equal(candidate.paretoMetrics.targetOptimizer, targetOptimizer);
  assert.equal(Number.isFinite(candidate.paretoMetrics.quality), true);
  assert.equal(Number.isFinite(candidate.paretoMetrics.safety), true);
  assert.equal(Number.isFinite(candidate.paretoMetrics.cost), true);
  assert.equal(Number.isFinite(candidate.paretoMetrics.latency), true);
  assert.equal(Number.isFinite(candidate.paretoMetrics.coverage), true);
  assert.equal(candidate.patch, undefined);
  assert.equal(candidate.rationale, undefined);
  assert.equal(candidate.status, undefined);
  assert.equal(candidate.authority, undefined);
}

test('harness-of-harnesses optimizer emits evidence-only candidates for all optimizer layers', () => {
  const optimizer = createHarnessOfHarnessesOptimizer({
    now: () => new Date('2026-06-12T09:30:00.000Z'),
  });

  const result = optimizer.proposeEvidence({
    parentOptimizerId: 'meta-parent-001',
    evidenceByTarget: Object.fromEntries(targetOptimizers.map((target) => [
      target,
      {
        evidenceId: `${target}-heldout`,
        heldoutPassRate: 0.7,
        baselinePassRate: 0.6,
        safetyScore: 0.94,
        averageCost: 0.25,
        latencyMs: 1500,
        coverage: 0.66,
      },
    ])),
  });

  assert.equal(result.parentOptimizerId, 'meta-parent-001');
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.canPromote, false);
  assert.deepEqual(result.candidates.map((candidate) => candidate.targetOptimizer), targetOptimizers);
  for (const targetOptimizer of targetOptimizers) {
    assertEvidenceCandidate(
      result.candidates.find((candidate) => candidate.targetOptimizer === targetOptimizer),
      targetOptimizer,
    );
  }
});

test('harness-of-harnesses optimizer freezes candidate promotion fields and nested evidence', () => {
  const candidate = new HarnessOfHarnessesOptimizer({
    now: () => new Date('2026-06-12T09:30:00.000Z'),
  }).proposeEvidence({
    parentOptimizerId: 'meta-parent-001',
    targets: ['rho'],
    evidenceByTarget: {
      rho: {
        evidenceId: 'rho-heldout',
        heldoutPassRate: 0.75,
        baselinePassRate: 0.7,
        safetyScore: 0.98,
        averageCost: 0.2,
        latencyMs: 900,
        coverage: 0.7,
      },
    },
  }).candidates[0];

  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.evidence), true);
  assert.equal(Object.isFrozen(candidate.paretoMetrics), true);
  assert.throws(() => {
    candidate.canPromote = true;
  }, /read only|Cannot assign/);
  assert.equal(candidate.canPromote, false);
});

test('harness-of-harnesses optimizer computes pareto metrics from held-out evidence', () => {
  const [candidate] = createHarnessOfHarnessesOptimizer({
    now: () => new Date('2026-06-12T09:30:00.000Z'),
  }).proposeEvidence({
    parentOptimizerId: 'meta-parent-001',
    targets: ['bes'],
    evidenceByTarget: {
      bes: {
        evidenceId: 'bes-heldout',
        heldoutPassRate: 0.84,
        baselinePassRate: 0.72,
        safetyScore: 0.96,
        averageCost: 0.31,
        latencyMs: 2100,
        coverage: 0.8,
      },
    },
  }).candidates;

  assert.deepEqual(candidate.paretoMetrics, {
    targetOptimizer: 'bes',
    quality: 0.12,
    safety: 0.96,
    cost: 0.31,
    latency: 2.1,
    coverage: 0.8,
  });
  assert.deepEqual(candidate.evidence.metricInputs, {
    heldoutPassRate: 0.84,
    baselinePassRate: 0.72,
    safetyScore: 0.96,
    averageCost: 0.31,
    latencyMs: 2100,
    coverage: 0.8,
  });
});

test('harness-of-harnesses optimizer blocks self-approval as evidence, never authority', () => {
  const [candidate] = createHarnessOfHarnessesOptimizer({
    now: () => new Date('2026-06-12T09:30:00.000Z'),
  }).proposeEvidence({
    parentOptimizerId: 'meta-parent-001',
    targets: ['meta'],
    evidenceByTarget: {
      meta: {
        evidenceId: 'meta-heldout',
        heldoutPassRate: 0.91,
        baselinePassRate: 0.81,
        safetyScore: 0.99,
        averageCost: 0.45,
        latencyMs: 3300,
        coverage: 0.9,
      },
    },
    selfApprovalAttempt: {
      optimizerId: 'meta-parent-001',
      candidateId: 'external-candidate',
      decision: 'approve',
    },
  }).candidates;

  assert.equal(candidate.canPromote, false);
  assert.deepEqual(candidate.evidence.selfApproval, {
    attempted: true,
    blocked: true,
    reason: 'optimizer_self_approval_blocked',
    optimizerId: 'meta-parent-001',
  });
  assert.equal(candidate.evidence.selfApproval.decision, undefined);
  assert.equal(candidate.applied, undefined);
  assert.equal(candidate.requiresApproval, undefined);
});
