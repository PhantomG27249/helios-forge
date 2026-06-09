import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyDenseSubgoals } from '../src/harness-sidecar/bes/denseSubgoalVerifier.js';
import { recordLineage } from '../src/harness-sidecar/bes/globalLineageTracker.js';
import { getBesLaneContract } from '../src/harness-sidecar/bes/laneContracts.js';
import { applyTrajectoryOperator } from '../src/harness-sidecar/bes/trajectoryOperators.js';

test('returns deterministic BES lane contracts for memory evolution', () => {
  const contract = getBesLaneContract('memory');

  assert.equal(contract.lane, 'memory');
  assert.equal(contract.candidateUnit, 'graph_policy');
  assert.equal(contract.verifierUnit, 'memory_eval');
});

test('applies deletion trajectory operator to remove a step', () => {
  const result = applyTrajectoryOperator({
    operator: 'deletion',
    trajectory: ['read', 'irrelevant', 'patch'],
    targetIndex: 1,
  });

  assert.deepEqual(result.trajectory, ['read', 'patch']);
  assert.equal(result.operator, 'deletion');
});

test('scores dense subgoals from matching evidence strings', () => {
  const result = verifyDenseSubgoals({
    subgoals: [{ id: 'tests', requires: 'npm test' }],
    evidence: ['npm test'],
  });

  assert.equal(result.score, 1);
  assert.deepEqual(result.satisfiedSubgoalIds, ['tests']);
});

test('records global lineage with deterministic parents', () => {
  const result = recordLineage({
    candidateId: 'global_1',
    parents: ['local_a', 'local_b'],
    operator: 'crossover',
  });

  assert.deepEqual(result.parents, ['local_a', 'local_b']);
  assert.equal(result.candidateId, 'global_1');
  assert.equal(result.operator, 'crossover');
});
