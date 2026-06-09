import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createAdaptiveSearchScheduler,
  recordAdaptiveSearchOutcome,
  selectAdaptiveSearchAction,
} from '../src/harness-sidecar/bes/adaptiveSearchScheduler.js';

test('first adaptive search selection prefers going wider when no evidence exists', () => {
  const scheduler = createAdaptiveSearchScheduler({ rng: () => 0.42 });

  const action = selectAdaptiveSearchAction({
    scheduler,
    context: {
      taskId: 'task_blank',
      evidence: [],
      budget: { pressure: 0.1 },
    },
  });

  assert.equal(action.arm, 'go_wider');
  assert.equal(action.actionId, 'adaptive_1');
  assert.equal(action.advisory, true);
  assert.equal(action.trace.type, 'ab_mcts.action_selected');
  assert.equal(action.trace.selectedArm, 'go_wider');
  assert.equal(action.trace.scores.every((score) => Number.isFinite(score.totalScore)), true);
  assert.equal(action.trace.scores.find((score) => score.arm === 'go_wider').reason.includes('no_evidence'), true);
});

test('strong reward shifts the next adaptive search selection toward going deeper', () => {
  const scheduler = createAdaptiveSearchScheduler({ rng: () => 0.1 });
  const first = selectAdaptiveSearchAction({
    scheduler,
    context: {
      taskId: 'task_promising_branch',
      evidence: [],
      budget: { pressure: 0.2 },
    },
  });

  recordAdaptiveSearchOutcome({
    scheduler,
    actionId: first.actionId,
    reward: {
      verifier: { passed: true, confidence: 0.94 },
      bes: { goalSatisfaction: 0.9 },
      swarm: { championScore: 0.88 },
      cost: { pressure: 0.15, latencyMs: 1200 },
    },
    evidence: { branchId: 'candidate_a', outcome: 'promising' },
  });

  const second = selectAdaptiveSearchAction({
    scheduler,
    context: {
      taskId: 'task_promising_branch',
      evidence: [{ kind: 'verifier', passed: true, confidence: 0.94 }],
      bestCandidate: { branchId: 'candidate_a', score: 0.9 },
      budget: { pressure: 0.2 },
    },
  });

  assert.equal(second.arm, 'go_deeper');
  assert.equal(second.trace.scores.find((score) => score.arm === 'go_deeper').reason.includes('strong_reward'), true);
  assert.equal(scheduler.arms.go_wider.visits, 1);
  assert.equal(scheduler.arms.go_wider.totalReward > 0.7, true);
});

test('budget pressure removes expensive adaptive search arms from selection', () => {
  const scheduler = createAdaptiveSearchScheduler({ rng: () => 0.2 });

  const action = selectAdaptiveSearchAction({
    scheduler,
    context: {
      taskId: 'task_budget_pressure',
      evidence: [{ kind: 'test', passed: true }],
      bestCandidate: { score: 0.78 },
      budget: { pressure: 0.96, remainingActions: 1 },
    },
  });

  const scoresByArm = Object.fromEntries(action.trace.scores.map((score) => [score.arm, score]));

  assert.equal(scoresByArm.go_wider.eligible, false);
  assert.equal(scoresByArm.switch_worker.eligible, false);
  assert.equal(scoresByArm.gather_evidence.eligible, false);
  assert.equal(['go_deeper', 'stop_or_promote'].includes(action.arm), true);
});

test('injected deterministic RNG produces stable adaptive search choices and serializable state', () => {
  const rngValues = [0.13, 0.77, 0.31];
  const makeScheduler = () => {
    let index = 0;
    return createAdaptiveSearchScheduler({
      rng: () => rngValues[index++ % rngValues.length],
      policy: { exploration: 0.2 },
    });
  };
  const context = {
    taskId: 'task_stable',
    evidence: [{ kind: 'lint', passed: false }],
    budget: { pressure: 0.35 },
  };

  const left = makeScheduler();
  const right = makeScheduler();
  const leftActions = [
    selectAdaptiveSearchAction({ scheduler: left, context }),
    selectAdaptiveSearchAction({ scheduler: left, context }),
    selectAdaptiveSearchAction({ scheduler: left, context }),
  ];
  const rightActions = [
    selectAdaptiveSearchAction({ scheduler: right, context }),
    selectAdaptiveSearchAction({ scheduler: right, context }),
    selectAdaptiveSearchAction({ scheduler: right, context }),
  ];

  assert.deepEqual(
    leftActions.map((action) => ({ arm: action.arm, actionId: action.actionId })),
    rightActions.map((action) => ({ arm: action.arm, actionId: action.actionId })),
  );
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(left)));
  assert.equal(Object.keys(left.arms).includes('stop_or_promote'), true);
});

