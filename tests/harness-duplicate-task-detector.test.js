import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectDuplicateTask } from '../src/harness-sidecar/collaboration/duplicateTaskDetector.js';

test('duplicate task detector recommends joining or forking similar active work', () => {
  const result = detectDuplicateTask({
    task: {
      taskId: 'task_new',
      summary: 'Implement controlled merge workflow with conflict recovery',
    },
    activeTasks: [
      {
        taskId: 'task_active_merge',
        summary: 'Add controlled merge conflict recovery workflow for champion branches',
        ownerId: 'agent_a',
      },
      {
        taskId: 'task_budget',
        summary: 'Build the budget dashboard panels',
        ownerId: 'agent_b',
      },
    ],
  });

  assert.equal(result.duplicateLikely, true);
  assert.equal(result.recommendedAction, 'join_or_fork');
  assert.equal(result.matches[0].taskId, 'task_active_merge');
  assert.equal(result.matches[0].ownerId, 'agent_a');
  assert.equal(result.matches[0].similarity >= 0.45, true);
});

test('duplicate task detector leaves unrelated work alone', () => {
  const result = detectDuplicateTask({
    task: {
      taskId: 'task_new',
      summary: 'Implement controlled merge workflow with conflict recovery',
    },
    activeTasks: [
      {
        taskId: 'task_visual',
        title: 'Production OCR worker',
        summary: 'Capture PDF pages and image crop artifacts for visual model runs',
      },
    ],
  });

  assert.deepEqual(result, {
    duplicateLikely: false,
    matches: [],
    recommendedAction: 'create_new',
  });
});
