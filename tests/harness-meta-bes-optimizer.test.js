import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BesMetaOptimizer } from '../src/harness-sidecar/meta/besMetaOptimizer.js';
import { HarnessOptimizer } from '../src/harness-sidecar/meta/harnessOptimizer.js';

const traceSummary = {
  failureModes: ['context_missing', 'verifier_failed'],
  budgetGates: [{ percent: 90 }],
};

const coreset = {
  items: [
    { id: 'trace-a', failureModes: ['context_missing'], target: 'retrieval_policy' },
    { id: 'trace-b', failureModes: ['verifier_failed'], target: 'tool_policy' },
  ],
};

test('BES meta optimizer generates deterministic approval-required candidates', () => {
  const optimizer = new BesMetaOptimizer({
    now: () => new Date('2026-06-08T12:34:56.000Z'),
    idPrefix: 'rho_test',
    maxCandidates: 4,
  });

  const result = optimizer.propose({
    traceSummary,
    target: 'retrieval_policy',
    coreset,
  });

  assert.equal(result.candidates.length, 4);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.candidateId),
    [
      'rho_test_20260608t123456000z_001',
      'rho_test_20260608t123456000z_002',
      'rho_test_20260608t123456000z_003',
      'rho_test_20260608t123456000z_004',
    ],
  );
  assert.equal(result.candidates.every((candidate) => candidate.status === 'approval_required'), true);
  assert.equal(result.candidates.every((candidate) => candidate.applied === false), true);
  assert.equal(result.candidates.every((candidate) => candidate.requiresApproval === true), true);
  assert.equal(result.candidates.every((candidate) => candidate.target === 'retrieval_policy'), true);
  assert.match(result.candidates[0].rationale, /context_missing/);
  assert.match(result.candidates[0].rationale, /Subgoals/);
  assert.equal(result.bes.subgoals.length >= 3, true);
  assert.equal(result.bes.genomes.length, 4);
  assert.equal(result.bes.diversity.attempts, 4);
  assert.equal(result.bes.champion.attemptId, result.bes.genomes[0].id);
});

test('BES meta optimizer covers harness policy targets with target-specific patches', () => {
  const optimizer = new BesMetaOptimizer({
    now: () => new Date('2026-06-08T12:34:56.000Z'),
    idPrefix: 'rho_target',
    maxCandidates: 1,
  });

  for (const target of ['prompt_policy', 'retrieval_policy', 'tool_policy', 'runtime_policy']) {
    const result = optimizer.propose({ traceSummary, target, coreset });
    const [candidate] = result.candidates;
    assert.equal(candidate.target, target);
    assert.match(candidate.patch.description, new RegExp(target));
    assert.equal(candidate.patch.applied, false);
  }
});

test('BES meta optimizer recombines parent candidates when supplied', () => {
  const optimizer = new BesMetaOptimizer({
    now: () => new Date('2026-06-08T12:34:56.000Z'),
    idPrefix: 'rho_parent',
    maxCandidates: 3,
  });

  const result = optimizer.propose({
    traceSummary,
    target: 'tool_policy',
    coreset,
    parentCandidates: [
      {
        candidateId: 'parent_a',
        bes: { genome: { id: 'parent_a', strategy: { name: 'minimal_patch' }, subgoalIds: ['address_context_missing'] } },
      },
      {
        candidateId: 'parent_b',
        bes: { genome: { id: 'parent_b', strategy: { name: 'verifier_first' }, subgoalIds: ['address_verifier_failed'] } },
      },
    ],
  });

  const recombined = result.bes.genomes.find((genome) => genome.lineage.parents.length === 2);
  assert.ok(recombined);
  assert.deepEqual(recombined.lineage.parents, ['parent_a', 'parent_b']);
  assert.equal(result.candidates.some((candidate) => /recombine/.test(candidate.rationale)), true);
});

test('BES meta optimizer consumes failure modes nested in RHO coreset trace items', () => {
  const optimizer = new BesMetaOptimizer({
    now: () => new Date('2026-06-08T00:00:00.000Z'),
    idPrefix: 'nested',
    maxCandidates: 1,
  });

  const result = optimizer.propose({
    traceSummary: { failureModes: [] },
    target: 'tool_policy',
    coreset: {
      items: [{
        taskId: 'task_hard',
        trace: {
          failureModes: ['tool_timeout'],
          failures: [{ category: 'verifier_failed' }],
          recoveryEvents: [{ category: 'context_missing' }],
        },
      }],
    },
  });

  assert.match(result.candidates[0].rationale, /tool_timeout/);
  assert.match(result.candidates[0].rationale, /verifier_failed/);
  assert.match(result.candidates[0].rationale, /context_missing/);
});

test('HarnessOptimizer keeps legacy propose shape unless BES mode is selected', () => {
  const legacy = new HarnessOptimizer().propose({
    traceSummary,
    target: 'prompt_policy',
    candidateRun: { smokePassed: true },
  });

  assert.equal(Array.isArray(legacy.candidates), false);
  assert.equal(legacy.status, 'approval_required');
  assert.equal(legacy.candidateRun.smokePassed, true);

  const bes = new HarnessOptimizer({
    mode: 'bes-rho',
    now: () => new Date('2026-06-08T12:34:56.000Z'),
    idPrefix: 'rho_harness',
    maxCandidates: 2,
  }).propose({
    traceSummary,
    target: 'prompt_policy',
    coreset,
  });

  assert.equal(bes.candidates.length, 2);
  assert.equal(bes.candidates[0].candidateId, 'rho_harness_20260608t123456000z_001');
  assert.equal(bes.bes.genomes.length, 2);
});
