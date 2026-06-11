import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeEvolutionOutput,
  normalizeSwarmCellOutput,
  validateSwarmCellContract,
} from '../src/harness-sidecar/swarm/swarmCellContracts.js';
import {
  getDefaultSwarmCells,
  resolveSwarmCell,
} from '../src/harness-sidecar/swarm/swarmCellRegistry.js';

test('normalizes legacy subagent output into task and evolution sections', () => {
  const normalized = normalizeSwarmCellOutput({
    summary: 'patched verifier',
    verifierEvidence: ['npm test'],
  });

  assert.equal(normalized.taskOutput.summary, 'patched verifier');
  assert.deepEqual(normalized.taskOutput.verifierEvidence, ['npm test']);
  assert.deepEqual(normalized.evolutionOutput.hardCaseTags, []);
  assert.equal(normalized.evolutionOutput.durableApplyRequested, false);
});

test('rejects local durable approval from a SwarmCell output', () => {
  const contract = validateSwarmCellContract({
    taskOutput: { summary: 'ok' },
    evolutionOutput: {
      suggestedCodeChange: { path: 'src/harness-sidecar/server.js' },
      durableApplyApproved: true,
    },
  });

  assert.equal(contract.valid, false);
  assert.equal(contract.reasons.includes('local_durable_approval_forbidden'), true);
});

test('normalizes evolution strings into arrays and preserves policy suggestions', () => {
  const evolutionOutput = normalizeEvolutionOutput({
    hardCaseTags: 'swarm_missing_verifier_evidence',
    suggestedPolicyChange: { lane: 'verifier' },
    evidenceRefs: 'trace:task-1',
  });

  assert.deepEqual(evolutionOutput.hardCaseTags, ['swarm_missing_verifier_evidence']);
  assert.deepEqual(evolutionOutput.evidenceRefs, ['trace:task-1']);
  assert.deepEqual(evolutionOutput.suggestedPolicyChange, { lane: 'verifier' });
});

test('default SwarmCell registry exposes local meta and memory enabled cells', () => {
  const cells = getDefaultSwarmCells();
  const codeCell = resolveSwarmCell('code');

  assert.equal(cells.length >= 5, true);
  assert.equal(codeCell.cellId, 'code');
  assert.equal(codeCell.localMetaHarness.enabled, true);
  assert.equal(codeCell.localMemoryGraph.enabled, true);
  assert.deepEqual(codeCell.mutationPolicy, { durableApply: 'global_only' });
  assert.equal(codeCell.outputContract.requiredFields.includes('summary'), true);
  assert.equal(codeCell.outputContract.requiredFields.includes('evolutionOutput'), true);
  assert.equal(Array.isArray(codeCell.localAgents), true);
});
