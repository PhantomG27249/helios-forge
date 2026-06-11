import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAdaptiveSearchScheduler } from '../src/harness-sidecar/bes/adaptiveSearchScheduler.js';
import { scheduleAttempts } from '../src/harness-sidecar/swarm/attemptScheduler.js';
import { planEvolutionSwarmAttempts } from '../src/harness-sidecar/swarm/evolutionSwarmPlanner.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

test('adaptive search disabled preserves existing seeded swarm scheduling', () => {
  const baseline = scheduleAttempts({
    taskId: 'task_ab_mcts_disabled',
    taskType: 'coding_bugfix',
    maxAttempts: 3,
  });
  const disabled = scheduleAttempts({
    taskId: 'task_ab_mcts_disabled',
    taskType: 'coding_bugfix',
    maxAttempts: 3,
    adaptiveSearch: {
      enabled: false,
      scheduler: createAdaptiveSearchScheduler({ rng: () => 0.1 }),
    },
  });

  assert.deepEqual(disabled, baseline);
});

test('adaptive search annotates weak-evidence swarm attempts with wider planning', () => {
  const attempts = scheduleAttempts({
    taskId: 'task_ab_mcts_wider',
    taskType: 'coding_bugfix',
    maxAttempts: 3,
    adaptiveSearch: {
      enabled: true,
      scheduler: createAdaptiveSearchScheduler({ rng: () => 0.1 }),
      context: {
        taskId: 'task_ab_mcts_wider',
        evidence: [],
        budget: { pressure: 0.1 },
      },
    },
  });

  assert.equal(attempts.length, 3);
  assert.equal(attempts.every((attempt) => attempt.adaptiveSearch?.arm === 'go_wider'), true);
  assert.equal(attempts.every((attempt) => attempt.planning?.strategy === 'adaptive_search'), true);
  assert.equal(attempts[0].planning.action.trace.type, 'ab_mcts.action_selected');
});

test('adaptive search model-choice metadata is preserved on scheduled attempts', () => {
  const attempts = scheduleAttempts({
    taskId: 'task_ab_mcts_model_choice',
    taskType: 'coding_bugfix',
    maxAttempts: 2,
    adaptiveSearch: {
      enabled: true,
      allowModelChoice: true,
      scheduler: createAdaptiveSearchScheduler({
        rng: () => 0.1,
        modelArms: [
          {
            armId: 'critic',
            role: 'reviewer',
            modelProfile: 'critic_low_temp',
            endpointProfile: 'critic_endpoint',
          },
        ],
      }),
      context: {
        taskId: 'task_ab_mcts_model_choice',
        evidence: [],
        budget: { pressure: 0.1 },
      },
    },
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts.every((attempt) => attempt.adaptiveSearch?.modelChoice?.armId === 'critic'), true);
  assert.equal(attempts[0].adaptiveSearch.modelChoice.actionId, 'model_choice_1');
  assert.equal(attempts[0].adaptiveSearch.modelChoice.modelProfile, 'critic_low_temp');
  assert.equal(attempts[0].adaptiveSearch.modelChoice.authority, 'evidence_only');
  assert.equal(attempts[0].adaptiveSearch.modelChoice.canPromote, false);
  assert.deepEqual(attempts[0].planning.action.modelChoice, attempts[0].adaptiveSearch.modelChoice);
});

test('evolution planning carries model-choice hints without replacing profile or specialization', () => {
  const attempts = planEvolutionSwarmAttempts({
    taskId: 'task_evolution_model_choice',
    taskType: 'coding_bugfix',
    maxAttempts: 1,
    evolutionArchive: [
      {
        candidateId: 'candidate-router-choice',
        strategy: 'reviewer_first',
        profileId: 'risk-auditor',
        specialization: 'reviewer',
        score: 0.82,
        adaptiveSearch: {
          modelChoice: {
            actionId: 'model_choice_existing',
            armId: 'critic',
            modelProfile: 'critic_low_temp',
            endpointProfile: 'critic_endpoint',
            authority: 'evidence_only',
            canPromote: false,
          },
        },
      },
    ],
  });

  assert.equal(attempts[0].profileId, 'risk-auditor');
  assert.equal(attempts[0].specialization, 'reviewer');
  assert.equal(attempts[0].adaptiveSearch.modelChoice.armId, 'critic');
  assert.equal(attempts[0].adaptiveSearch.modelChoice.modelProfile, 'critic_low_temp');
});

test('swarm orchestration emits adaptive search selection and outcome events', async () => {
  const events = [];
  const scheduler = createAdaptiveSearchScheduler({ rng: () => 0.1 });
  const result = await orchestrateSwarm({
    task: { taskId: 'task_ab_mcts_runtime', goal: 'Exercise adaptive search in swarm.' },
    taskType: 'coding_bugfix',
    maxAttempts: 1,
    planner: {
      adaptiveSearch: {
        enabled: true,
        scheduler,
        context: {
          taskId: 'task_ab_mcts_runtime',
          evidence: [],
          budget: { pressure: 0.1 },
        },
      },
    },
    commandAdapter: async () => ({
      patch: 'diff --git a/file.js b/file.js',
      verifierEvidence: [{ passed: true, confidence: 0.9 }],
      score: 0.86,
    }),
    onAttemptEvent: async (event) => events.push(event),
  });

  assert.equal(result.planning.adaptiveSearch.selectedArm, 'go_wider');
  assert.equal(events.some((event) => event.type === 'ab_mcts.action_selected'), true);
  assert.equal(events.some((event) => event.type === 'ab_mcts.outcome_recorded'), true);
  assert.equal(events.some((event) => event.type === 'ab_mcts.scheduler_summary'), true);
  assert.equal(scheduler.arms.go_wider.visits, 1);
});
