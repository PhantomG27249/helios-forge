import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planEvolutionSwarmAttempts } from '../src/harness-sidecar/swarm/evolutionSwarmPlanner.js';
import { scheduleAttempts } from '../src/harness-sidecar/swarm/attemptScheduler.js';

test('evolution archive entries become ranked attempt records with lineage and island metadata', () => {
  const attempts = planEvolutionSwarmAttempts({
    taskId: 'task_evo_plan',
    taskType: 'coding_bugfix',
    maxAttempts: 3,
    evolutionArchive: [
      {
        candidateId: 'low_score',
        islandId: 'island_a',
        lineage: { parent: 'seed_a', generation: 1 },
        score: 0.2,
        correct: true,
        strategy: 'too_small',
      },
      {
        candidateId: 'best',
        islandId: 'island_b',
        lineage: { parent: 'seed_b', generation: 2 },
        score: 0.93,
        correct: true,
        bes: { goalScore: { score: 0.89 } },
        genome: { strategy: 'verify_then_patch' },
      },
      {
        candidateId: 'incorrect_high_score',
        islandId: 'island_c',
        score: 0.99,
        correct: false,
        strategy: 'unsafe_fast_patch',
      },
    ],
  });

  assert.equal(attempts.length, 3);
  assert.equal(attempts[0].strategy, 'verify_then_patch');
  assert.equal(attempts[0].lineage.parent, 'seed_b');
  assert.equal(attempts[0].goalScore.score, 0.89);
  assert.equal(attempts[0].islandId, 'island_b');
  assert.equal(attempts[0].specialization, 'implementer');
  assert.equal(attempts[0].planning.strategy, 'evolution_archive');
  assert.equal(attempts[2].strategy, 'unsafe_fast_patch');
});

test('evolution planner preserves diversity across islands when high scores cluster', () => {
  const attempts = planEvolutionSwarmAttempts({
    taskId: 'task_diversity',
    maxAttempts: 3,
    evolutionArchive: [
      { candidateId: 'a1', islandId: 'island_a', score: 0.99, correct: true },
      { candidateId: 'a2', islandId: 'island_a', score: 0.98, correct: true },
      { candidateId: 'b1', islandId: 'island_b', score: 0.7, correct: true },
      { candidateId: 'c1', islandId: 'island_c', score: 0.6, correct: true },
    ],
  });

  assert.equal(new Set(attempts.map((attempt) => attempt.islandId)).size >= 2, true);
  assert.equal(attempts[0].candidateId, 'a1');
  assert.equal(attempts.some((attempt) => attempt.candidateId === 'b1'), true);
});

test('evolution planner includes missing BES frontier goals as attempt records', () => {
  const attempts = planEvolutionSwarmAttempts({
    taskId: 'task_missing_goals',
    maxAttempts: 3,
    evolutionArchive: [
      { candidateId: 'archive_a', islandId: 'island_a', score: 0.8, correct: true },
    ],
    bidirectionalBes: {
      frontier: [
        {
          candidateId: 'frontier_missing_visual',
          evidence: [{ goalId: 'visual_layout', passed: false, note: 'VLM screenshot mismatch' }],
          goalScore: { score: 0.42, missingGoalIds: ['visual_layout'] },
        },
      ],
    },
  });

  assert.equal(attempts.some((attempt) => attempt.candidateId === 'frontier_missing_visual'), true);
  const frontierAttempt = attempts.find((attempt) => attempt.candidateId === 'frontier_missing_visual');
  assert.equal(frontierAttempt.planning.strategy, 'bes_frontier_gap');
  assert.equal(frontierAttempt.specialization, 'visual-specialist');
});

test('evolution planner falls back to seeded attempts when archive and frontier are empty', () => {
  const fallbackAttempts = [
    { attemptId: 'attempt_seeded', taskId: 'task_empty', strategy: 'seeded_only', budgetWeight: 0.4 },
  ];
  const attempts = planEvolutionSwarmAttempts({
    taskId: 'task_empty',
    maxAttempts: 2,
    evolutionArchive: [],
    bidirectionalBes: { frontier: [] },
    fallbackAttempts,
  });

  assert.deepEqual(attempts, fallbackAttempts);
});

test('scheduleAttempts prefers evolution planner when enabled without breaking seeded fallback', () => {
  const attempts = scheduleAttempts({
    taskId: 'task_schedule_evo',
    taskType: 'visual_ui',
    maxAttempts: 2,
    evolutionPlanner: {
      enabled: true,
      evolutionArchive: [
        {
          candidateId: 'visual_candidate',
          islandId: 'island_v',
          score: 0.75,
          correct: true,
          evidence: [{ note: 'visual artifact checked with VLM' }],
        },
      ],
    },
  });

  assert.equal(attempts[0].planning.strategy, 'evolution_archive');
  assert.equal(attempts[0].specialization, 'visual-specialist');

  const seeded = scheduleAttempts({ taskId: 'task_seeded', taskType: 'coding_bugfix', maxAttempts: 1 });
  assert.equal(seeded[0].strategy, 'reproduce_first');
});
