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

test('adaptive search can attach evidence-only model-choice metadata', () => {
  const scheduler = createAdaptiveSearchScheduler({
    rng: () => 0.2,
    modelArms: [
      { armId: 'fast', role: 'implementer', modelProfile: 'fast_model', endpointProfile: 'local_fast' },
      { armId: 'critic', role: 'reviewer', modelProfile: 'critic_low_temp', endpointProfile: 'local_critic' },
    ],
  });

  const action = selectAdaptiveSearchAction({
    scheduler,
    context: {
      taskId: 'task-model-choice-scheduler',
      taskType: 'code',
      allowModelChoice: true,
      evidence: [],
      budget: { pressure: 0.1 },
    },
  });

  assert.equal(action.arm, 'go_wider');
  assert.equal(action.modelChoice.actionId, 'model_choice_1');
  assert.equal(action.modelChoice.armId, 'fast');
  assert.equal(action.modelChoice.modelProfile, 'fast_model');
  assert.equal(action.modelChoice.endpointProfile, 'local_fast');
  assert.equal(action.modelChoice.authority, 'evidence_only');
  assert.equal(action.modelChoice.canPromote, false);
  assert.deepEqual(action.trace.modelChoice, action.modelChoice);
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

test('adaptive search allocates bounded budget across text tool swarm visual replay and verifier actions', () => {
  const scheduler = createAdaptiveSearchScheduler({ rng: () => 0.12 });

  const action = selectAdaptiveSearchAction({
    scheduler,
    context: {
      taskId: 'task-action-budget',
      evidence: [{ kind: 'candidate', score: 0.88 }],
      bestCandidate: { score: 0.88, confidence: 0.62 },
      budget: {
        pressure: 0.35,
        remainingByActionType: {
          text: 4,
          tool: 0,
          swarm: 2,
          visual: 1,
          replay: 1,
          verifier: 1,
        },
      },
      signals: {
        visualSurface: true,
        needsReplay: true,
        needsVerifier: true,
      },
    },
  });

  const scoresByType = Object.fromEntries(
    action.trace.actionTypeScores.map((score) => [score.actionType, score]),
  );

  assert.equal(action.actionType, 'verifier');
  assert.deepEqual(Object.keys(scoresByType).sort(), ['replay', 'swarm', 'text', 'tool', 'verifier', 'visual']);
  assert.equal(scoresByType.tool.eligible, false);
  assert.equal(scoresByType.tool.reason.includes('action_budget_exhausted'), true);
  assert.equal(scoresByType.verifier.reason.includes('candidate_needs_verifier'), true);
  assert.equal(scheduler.actionTypes.verifier.visits, 0);
});

test('adaptive search stops instead of selecting an exhausted action type', () => {
  const scheduler = createAdaptiveSearchScheduler({ rng: () => 0.12 });

  const action = selectAdaptiveSearchAction({
    scheduler,
    context: {
      taskId: 'task-action-exhausted',
      evidence: [{ kind: 'candidate', score: 0.88 }],
      budget: {
        pressure: 0.35,
        remainingByActionType: {
          text: 0,
          tool: 0,
          swarm: 0,
          visual: 0,
          replay: 0,
          verifier: 0,
        },
      },
    },
  });

  assert.equal(action.arm, 'stop_or_promote');
  assert.equal(action.actionType, null);
  assert.equal(action.trace.actionTypeExhausted, true);
  assert.equal(action.trace.actionTypeScores.every((score) => score.eligible === false), true);
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
