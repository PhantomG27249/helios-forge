import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runEvolutionPopulation } from '../src/harness-sidecar/bes/evolutionPopulationRunner.js';

test('runs Shinka-style population evolution with islands, archive, and visual cases', async () => {
  const result = await runEvolutionPopulation({
    task: { taskId: 'task_visual_policy' },
    initialCandidates: [
      { candidateId: 'seed_a', program: 'a', islandId: 'island_1' },
      { candidateId: 'seed_b', program: 'b', islandId: 'island_2' },
    ],
    generations: 2,
    islands: 2,
    archiveSize: 3,
    visualCases: [
      { caseId: 'visual_layout', kind: 'visual', expected: { tags: ['visual', 'vlm'] } },
    ],
    verifierCases: [
      { caseId: 'unit_smoke', kind: 'unit', expected: { tags: ['unit'] } },
    ],
    mutateCandidate: async ({ parent, generation }) => ({
      ...parent,
      candidateId: `${parent.candidateId}_g${generation}`,
      patch: { description: `generation ${generation} patch` },
    }),
    evaluateCandidate: async ({ candidate, evaluationContext }) => ({
      score: candidate.candidateId.includes('g2') ? 0.92 : 0.61,
      correct: true,
      metrics: {
        combinedScore: candidate.candidateId.includes('g2') ? 0.92 : 0.61,
        visualScore: evaluationContext.visualCases.length ? 0.88 : 0,
      },
      visual: {
        caseIds: evaluationContext.visualCases.map((item) => item.caseId),
        vlmRequired: evaluationContext.visualCases.length > 0,
      },
    }),
  });

  assert.equal(result.generations.length, 2);
  assert.equal(result.islands.length, 2);
  assert.equal(result.archive.length, 3);
  assert.equal(result.best.candidateId.endsWith('_g2'), true);
  assert.deepEqual(result.best.visual.caseIds, ['visual_layout']);
  assert.equal(result.events.some((event) => event.type === 'evolution.visual_cases_attached'), true);
  assert.equal(result.events.some((event) => event.type === 'evolution.archive_updated'), true);
});

test('keeps correctness gates ahead of raw score in the archive', async () => {
  const result = await runEvolutionPopulation({
    task: { taskId: 'task_correctness' },
    initialCandidates: [
      { candidateId: 'seed_safe', program: 'safe' },
      { candidateId: 'seed_fast_bad', program: 'bad' },
    ],
    generations: 1,
    archiveSize: 2,
    mutateCandidate: async ({ parent }) => ({ ...parent, candidateId: `${parent.candidateId}_child` }),
    evaluateCandidate: async ({ candidate }) => ({
      score: candidate.candidateId.includes('bad') ? 0.99 : 0.7,
      correct: !candidate.candidateId.includes('bad'),
      metrics: { combinedScore: candidate.candidateId.includes('bad') ? 0.99 : 0.7 },
    }),
  });

  assert.equal(result.best.correct, true);
  assert.equal(result.archive.some((entry) => entry.correct === false), true);
  assert.equal(result.archive[0].correct, true);
});
