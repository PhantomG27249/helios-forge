import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAdaptiveSearchScheduler } from '../src/harness-sidecar/bes/adaptiveSearchScheduler.js';
import { scheduleAttempts } from '../src/harness-sidecar/swarm/attemptScheduler.js';
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
