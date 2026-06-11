import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSoulRefs } from '../src/harness-sidecar/souls/soulEvidence.js';
import { normalizeLaneEvidence } from '../src/harness-sidecar/bes/laneEvidence.js';
import { normalizeSwarmCellOutput, validateSwarmCellContract } from '../src/harness-sidecar/swarm/swarmCellContracts.js';
import { runBesLaneRuntime } from '../src/harness-sidecar/bes/laneRuntime.js';

test('normalizeSoulRefs keeps reference-only metadata and drops raw authority fields', () => {
  const refs = normalizeSoulRefs({
    soulId: 'implementer',
    soulVersion: '2',
    oversoulVersion: '5',
    mutationLineage: ['parent', '../bad', 'child'],
    rawPrompt: 'do unsafe',
    patch: 'diff',
    toolAuthority: ['shell'],
  });

  assert.deepEqual(refs, {
    soulId: 'implementer',
    soulVersion: '2',
    oversoulVersion: '5',
    mutationLineage: ['child', 'parent'],
    evidenceOnly: true,
    promotionAuthority: false,
  });
});

test('swarm cell contracts preserve soul refs without granting local approval', () => {
  const output = normalizeSwarmCellOutput({
    summary: 'ok',
    soulRefs: { soulId: 'reviewer', soulVersion: '1', oversoulVersion: '2' },
    evolutionOutput: {
      soulRefs: { soulId: 'reviewer', soulVersion: '1' },
      durableApplyApproved: true,
    },
  });
  const validation = validateSwarmCellContract({
    soulRefs: { soulId: 'reviewer', soulVersion: '1' },
    evolutionOutput: { durableApplyApproved: true },
  });

  assert.equal(output.taskOutput.soulRefs.soulId, 'reviewer');
  assert.equal(output.evolutionOutput.soulRefs.promotionAuthority, false);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.reasons, ['local_durable_approval_forbidden']);
});

test('swarm cell contracts preserve evolution level refs in task and evolution output', () => {
  const output = normalizeSwarmCellOutput({
    summary: 'recursive improvement proposed',
    evolutionLevelRefs: {
      level: 'subagent_society',
      levelId: 'implementation_society',
      version: '2',
      childRefs: [{ level: 'subagent_soul', levelId: 'coder', version: '1' }],
    },
    evolutionOutput: {
      evolutionLevelRefs: {
        level: 'swarm_cell',
        levelId: 'code_cell',
        version: '3',
      },
    },
  });

  assert.equal(output.taskOutput.evolutionLevelRefs[0].level, 'subagent_society');
  assert.equal(output.taskOutput.evolutionLevelRefs[0].childRefs[0].levelId, 'coder');
  assert.equal(output.evolutionOutput.evolutionLevelRefs[0].level, 'swarm_cell');
  assert.equal(output.evolutionOutput.evolutionLevelRefs[0].promotionAuthority, false);
});

test('BES lane runtime attaches soul refs as evidence-only lane metadata', async () => {
  const result = await runBesLaneRuntime({
    lane: 'swarm',
    taskId: 'task_soul',
    candidates: [{
      candidateId: 'attempt_1',
      soulRefs: { soulId: 'implementer', soulVersion: '2', oversoulVersion: '7' },
      evidence: ['verifier passed'],
      externalPolicyEvidence: { id: 'policy_1' },
    }],
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.soulRefs.soulId, 'implementer');
  assert.equal(candidate.evidence.summary.soulRefCount, 1);
  assert.equal(candidate.evidence.sources.includes('soul_refs'), true);
  assert.equal(candidate.promotion.allowed, false);
});

test('BES lane runtime preserves evolution level refs as evidence-only lane metadata', async () => {
  const result = await runBesLaneRuntime({
    lane: 'swarm',
    taskId: 'task_levels',
    candidates: [{
      candidateId: 'attempt_levels',
      evolutionLevelRefs: {
        level: 'subagent_society',
        levelId: 'implementation_society',
        version: '1',
      },
    }],
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.evolutionLevelRefs[0].level, 'subagent_society');
  assert.equal(candidate.evolutionLevelRefs[0].promotionAuthority, false);
  assert.equal(candidate.evidence.summary.evolutionLevelRefCount, 1);
  assert.equal(candidate.evidence.sources.includes('evolution_level_refs'), true);
  assert.equal(candidate.evidence.hasRequiredEvidence, false);
  assert.ok(candidate.promotion.blockedReasons.includes('missing_required_evidence'));
});

test('soul refs alone do not satisfy required substantive lane evidence', () => {
  const evidence = normalizeLaneEvidence({
    soulRefs: { soulId: 'implementer', soulVersion: '2' },
  });

  assert.equal(evidence.sources.includes('soul_refs'), true);
  assert.equal(evidence.hasRequiredEvidence, false);
  assert.equal(evidence.summary.soulRefCount, 1);
});

test('evolution level refs alone do not satisfy required substantive lane evidence', () => {
  const evidence = normalizeLaneEvidence({
    evolutionLevelRefs: { level: 'subagent_society', levelId: 'implementation_society' },
  });

  assert.equal(evidence.sources.includes('evolution_level_refs'), true);
  assert.equal(evidence.hasRequiredEvidence, false);
  assert.equal(evidence.summary.evolutionLevelRefCount, 1);
});
