import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allocateEvolutionSwarmBudgets } from '../src/harness-sidecar/swarm/evolutionBudgetAllocator.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

test('high goal score gets a higher attempt budget and rationale', () => {
  const attempts = allocateEvolutionSwarmBudgets({
    maxOutputChars: 1000,
    attempts: [
      { attemptId: 'low', strategy: 'explore', goalScore: { score: 0.25 }, budgetWeight: 0.3 },
      { attemptId: 'high', strategy: 'exploit', goalScore: { score: 0.9 }, budgetWeight: 0.9 },
    ],
  });

  assert.equal(attempts[1].budget.priority > attempts[0].budget.priority, true);
  assert.equal(attempts[1].budget.maxOutputChars > attempts[0].budget.maxOutputChars, true);
  assert.match(attempts[1].budgetRationale.rationale, /goal score/i);
});

test('low score with novelty still receives a small exploration budget', () => {
  const [attempt] = allocateEvolutionSwarmBudgets({
    maxOutputChars: 1000,
    attempts: [
      {
        attemptId: 'novel_low_score',
        goalScore: { score: 0.1 },
        novelty: 0.95,
        planning: { diversity: 'new_island' },
      },
    ],
  });

  assert.equal(attempt.budget.maxOutputChars >= 100, true);
  assert.equal(attempt.budget.maxToolCalls >= 1, true);
  assert.match(attempt.budgetRationale.rationale, /exploration/i);
});

test('visual specialist attempts get VLM artifact budget metadata', () => {
  const [attempt] = allocateEvolutionSwarmBudgets({
    attempts: [{ attemptId: 'visual', specialization: 'visual-specialist', goalScore: { score: 0.6 } }],
    visualBudget: { maxArtifacts: 3 },
  });

  assert.equal(attempt.budget.visualArtifactsAllowed, true);
  assert.equal(attempt.budget.visual.maxArtifacts, 3);
  assert.match(attempt.budgetRationale.rationale, /visual/i);
});

test('budget pressure downshifts expensive attempts', () => {
  const [normal] = allocateEvolutionSwarmBudgets({
    maxOutputChars: 1200,
    attempts: [{ attemptId: 'expensive', goalScore: { score: 0.95 }, budgetWeight: 1 }],
  });
  const [pressured] = allocateEvolutionSwarmBudgets({
    maxOutputChars: 1200,
    budgetState: { budgetPercent: 94, contextPercent: 50 },
    attempts: [{ attemptId: 'expensive', goalScore: { score: 0.95 }, budgetWeight: 1 }],
  });

  assert.equal(pressured.budget.maxOutputChars < normal.budget.maxOutputChars, true);
  assert.equal(pressured.budget.maxToolCalls < normal.budget.maxToolCalls, true);
  assert.match(pressured.budgetRationale.rationale, /pressure/i);
});

test('orchestrator applies evolution budget metadata before running attempts', async () => {
  const seenBudgets = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_budget_orchestrator', goal: 'Budget attempts.' },
    maxAttempts: 1,
    evolutionBudget: { enabled: true, maxOutputChars: 800 },
    planner: {
      enabled: true,
      strategy: 'tooltree',
      expandNode: () => [{ action: { strategy: 'planned' }, state: { key: 'planned' } }],
      evaluateNode: () => 1,
    },
    commandAdapter: async ({ attempt, budget }) => {
      seenBudgets.push({ attempt, budget });
      return { patch: 'patch', verifierEvidence: ['budget evidence'], score: 70 };
    },
  });

  assert.equal(seenBudgets.length, 1);
  assert.equal(seenBudgets[0].attempt.budget.maxOutputChars, seenBudgets[0].budget.maxOutputChars);
  assert.match(seenBudgets[0].attempt.budgetRationale.rationale, /goal score|baseline/i);
  assert.equal(result.attempts[0].budgetRationale.rationale, seenBudgets[0].attempt.budgetRationale.rationale);
});
