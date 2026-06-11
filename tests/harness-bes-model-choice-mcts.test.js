import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planModelChoiceMcts } from '../src/harness-sidecar/bes/modelChoiceMcts.js';

function seededRng(values = [0.17, 0.61, 0.33, 0.89]) {
  let index = 0;
  return () => values[index++ % values.length];
}

test('AB-MCTS expands search actions into model-choice children and backpropagates both levels', () => {
  const plan = planModelChoiceMcts({
    task: { taskId: 'task-model-choice', type: 'code' },
    actionArms: ['go_wider', 'go_deeper', 'refine'],
    modelArms: [
      {
        armId: 'fast',
        role: 'implementer',
        modelProfile: 'fast_model',
        endpointProfile: 'local_fast',
        posterior: { alpha: 3, beta: 2, observations: 3 },
      },
      {
        armId: 'critic',
        role: 'reviewer',
        modelProfile: 'critic_low_temp',
        endpointProfile: 'local_critic',
        posterior: { alpha: 6, beta: 1, observations: 6 },
      },
    ],
    iterations: 8,
    rng: seededRng(),
  });

  assert.equal(plan.root.kind, 'root');
  assert.deepEqual(plan.root.children.map((child) => child.arm), ['go_wider', 'go_deeper', 'refine']);
  assert.equal(plan.root.children.every((child) => child.kind === 'search_action'), true);
  assert.equal(plan.root.children.every((child) => child.children.length === 2), true);

  const modelChoiceNodes = plan.root.children.flatMap((child) => child.children);
  assert.equal(modelChoiceNodes.every((child) => child.kind === 'model_choice'), true);
  assert.equal(modelChoiceNodes.every((child) => child.modelProfile && child.endpointProfile), true);
  assert.equal(modelChoiceNodes.every((child) => child.authority === 'evidence_only'), true);
  assert.equal(modelChoiceNodes.every((child) => child.canPromote === false), true);

  assert.equal(plan.selectedNode.kind, 'model_choice');
  assert.ok(plan.selectedNode.modelProfile);
  assert.equal(plan.selectedNode.visits > 0, true);
  assert.equal(plan.selectedNode.parent.visits > 0, true);
  assert.equal(plan.root.visits, 8);
  assert.ok(plan.selectedNode.routerPosterior);
});
