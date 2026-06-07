import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildHarnessTaskMessage,
  classifyHarnessPrompt,
} from '../src/harness/promptHarnessRouter.js';

test('normal prompts launch the full harness in background mode', () => {
  const route = classifyHarnessPrompt('fix the failing workspace picker test');

  assert.deepEqual(route, {
    shouldRun: true,
    mode: 'background',
    task: 'fix the failing workspace picker test',
    reason: 'automatic_background',
  });
});

test('explicit harness prompts launch as direct tasks', () => {
  const route = classifyHarnessPrompt('use the BES and meta harness on this project');

  assert.equal(route.shouldRun, true);
  assert.equal(route.mode, 'direct');
  assert.equal(route.reason, 'explicit_harness_intent');
  assert.equal(route.task, 'use the BES and meta harness on this project');
});

test('slash harness prompts launch direct tasks without the command prefix', () => {
  const route = classifyHarnessPrompt('/harness inspect the current repo graph');

  assert.equal(route.shouldRun, true);
  assert.equal(route.mode, 'direct');
  assert.equal(route.task, 'inspect the current repo graph');
});

test('streaming follow-up prompts do not auto-launch harness tasks', () => {
  const route = classifyHarnessPrompt('also check the tests', { isStreaming: true });

  assert.equal(route.shouldRun, false);
  assert.equal(route.reason, 'streaming_prompt');
});

test('harness task messages use the real full runtime defaults', () => {
  const route = classifyHarnessPrompt('run the meta harness for this task');
  const message = buildHarnessTaskMessage(route);

  assert.deepEqual(message, {
    type: 'harness_task_start',
    task: 'run the meta harness for this task',
    mode: 'full',
    budget: { maxToolCalls: 20, maxWallMinutes: 15 },
    source: 'prompt_direct',
  });
});
