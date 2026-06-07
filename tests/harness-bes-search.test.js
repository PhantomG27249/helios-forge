import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAttemptGenome, validateAttemptGenome } from '../src/harness-sidecar/bes/attemptGenome.js';
import { archiveChampion, createChampionArchive, selectBestChampion } from '../src/harness-sidecar/bes/championArchive.js';
import { createDiversityTracker } from '../src/harness-sidecar/bes/diversityTracker.js';
import { proposeMutations } from '../src/harness-sidecar/bes/mutationPolicy.js';
import { recombineAttempts } from '../src/harness-sidecar/bes/recombinationEngine.js';

test('creates a valid attempt genome with strategy, subgoals, mutations, and lineage', () => {
  const genome = createAttemptGenome({
    id: 'attempt_1',
    strategy: { id: 'strategy_1', name: 'reproduce_first' },
    subgoals: [{ id: 'S1' }, { id: 'S2' }],
    mutations: [{ type: 'focus_subgoal', targetSubgoalId: 'S1', budgetCost: 1 }],
    lineage: { parents: ['seed'], generation: 1 },
  });

  assert.equal(genome.id, 'attempt_1');
  assert.equal(genome.strategy.name, 'reproduce_first');
  assert.deepEqual(genome.subgoalIds, ['S1', 'S2']);
  assert.equal(validateAttemptGenome(genome).valid, true);
});

test('recombines partial successes into a child genome using solved-subgoal evidence', () => {
  const parentA = createAttemptGenome({
    id: 'attempt_a',
    strategy: { id: 'strategy_1', name: 'reproduce_first' },
    subgoals: [{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }],
  });
  const parentB = createAttemptGenome({
    id: 'attempt_b',
    strategy: { id: 'strategy_2', name: 'minimal_patch' },
    subgoals: [{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }],
  });

  const child = recombineAttempts({
    id: 'attempt_child',
    parents: [parentA, parentB],
    evidenceByAttemptId: {
      attempt_a: {
        solvedSubgoalIds: ['S1'],
        evidence: [{ subgoalId: 'S1', note: 'failure reproduced' }],
      },
      attempt_b: {
        solvedSubgoalIds: ['S2'],
        evidence: [{ subgoalId: 'S2', note: 'patch identified' }],
      },
    },
  });

  assert.equal(child.id, 'attempt_child');
  assert.deepEqual(child.lineage.parents, ['attempt_a', 'attempt_b']);
  assert.deepEqual(child.solvedSubgoalIds, ['S1', 'S2']);
  assert.deepEqual(child.evidence.map((entry) => entry.subgoalId), ['S1', 'S2']);
  assert.equal(child.strategy.name, 'recombine:reproduce_first+minimal_patch');
});

test('proposes mutations bounded by remaining budget', () => {
  const mutations = proposeMutations({
    missingSubgoalIds: ['S2', 'S3', 'S4'],
    failureModes: ['verifier_failed', 'context_missing'],
    budget: 2,
  });

  assert.equal(mutations.length, 2);
  assert.deepEqual(mutations.map((mutation) => mutation.targetSubgoalId), ['S2', 'S3']);
  assert.equal(mutations.reduce((sum, mutation) => sum + mutation.budgetCost, 0), 2);
});

test('detects diversity collapse when attempts converge on the same search signature', () => {
  const tracker = createDiversityTracker({ collapseThreshold: 0.2 });
  const result = tracker.score([
    createAttemptGenome({
      id: 'attempt_1',
      strategy: { id: 'strategy_1', name: 'minimal_patch' },
      subgoals: [{ id: 'S1' }, { id: 'S2' }],
      mutations: [{ type: 'focus_subgoal', targetSubgoalId: 'S2' }],
    }),
    createAttemptGenome({
      id: 'attempt_2',
      strategy: { id: 'strategy_1', name: 'minimal_patch' },
      subgoals: [{ id: 'S1' }, { id: 'S2' }],
      mutations: [{ type: 'focus_subgoal', targetSubgoalId: 'S2' }],
    }),
    createAttemptGenome({
      id: 'attempt_3',
      strategy: { id: 'strategy_1', name: 'minimal_patch' },
      subgoals: [{ id: 'S1' }, { id: 'S2' }],
      mutations: [{ type: 'focus_subgoal', targetSubgoalId: 'S2' }],
    }),
  ]);

  assert.equal(result.uniqueSignatures, 1);
  assert.equal(result.collapsed, true);
});

test('champion archive selects the best safe attempt by score and cost', () => {
  const archive = createChampionArchive();
  archiveChampion(archive, {
    attemptId: 'expensive_best',
    score: 90,
    safety: 'safe',
    cost: 8,
  });
  archiveChampion(archive, {
    attemptId: 'unsafe_best',
    score: 95,
    safety: 'unsafe',
    cost: 1,
  });
  archiveChampion(archive, {
    attemptId: 'cheap_best',
    score: 90,
    safety: 'safe',
    cost: 3,
  });

  assert.equal(selectBestChampion(archive).attemptId, 'cheap_best');
});
