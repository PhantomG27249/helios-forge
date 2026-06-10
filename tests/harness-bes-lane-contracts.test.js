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

test('lane contracts expose fusion, dense verifier, and champion evidence metadata', () => {
  const contract = getBesLaneContract('harness');

  assert.equal(contract.fusion.evidenceOnly, true);
  assert.equal(contract.fusion.promotionAuthority, false);
  assert.equal(contract.fusion.forward.candidateUnit, 'harness_configuration');
  assert.equal(contract.fusion.backward.verifierUnit, 'harness_experiment_eval');
  assert.equal(contract.denseVerifierContract.lane, 'harness');
  assert.equal(contract.denseVerifierContract.verifierUnit, 'harness_experiment_eval');
  assert.deepEqual(contract.championEvidenceHooks, ['champion_archive', 'frontier']);
});

test('returns BES lane contracts for policy sublanes', () => {
  const context = getBesLaneContract('context');
  const mcpTrust = getBesLaneContract('mcp_trust');

  assert.equal(context.candidateUnit, 'context_policy');
  assert.equal(context.verifierUnit, 'context_eval');
  assert.ok(context.artifacts.includes('context_profile'));
  assert.equal(mcpTrust.candidateUnit, 'mcp_trust_policy');
  assert.equal(mcpTrust.verifierUnit, 'mcp_trust_eval');
  assert.ok(mcpTrust.artifacts.includes('capability_scope'));
});

test('applies deletion trajectory operator to remove a step', () => {
  const result = applyTrajectoryOperator({
    operator: 'deletion',
    trajectory: ['read', 'irrelevant', 'patch'],
    targetIndex: 1,
    lane: 'code',
    candidateId: 'code_candidate_1',
    compatibleFamily: 'code-patch',
  });

  assert.deepEqual(result.trajectory, ['read', 'patch']);
  assert.equal(result.operator, 'deletion');
  assert.deepEqual(result.provenance, {
    lane: 'code',
    candidateId: 'code_candidate_1',
    operator: 'deletion',
    operatorFamily: 'mutation',
    compatibleFamily: 'code-patch',
    inputLength: 3,
    outputLength: 2,
    promotionAuthority: false,
  });
});

test('scores dense subgoals from matching evidence strings', () => {
  const result = verifyDenseSubgoals({
    subgoals: [{ id: 'tests', requiredEvidence: 'npm test' }],
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

test('lineage tracker falls back for blank ids after trimming', () => {
  const result = recordLineage({
    candidateId: '   ',
    parents: [' local_b ', 'local_a'],
    operator: '   ',
  });

  assert.equal(result.candidateId, 'candidate');
  assert.equal(result.operator, 'seed');
  assert.deepEqual(result.parents, ['local_a', 'local_b']);
  assert.equal(result.lineageId, 'candidate:seed:local_a:local_b');
});
