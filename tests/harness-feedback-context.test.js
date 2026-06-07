import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyHarnessFeedbackToPrompt,
  createHarnessFeedbackBuffer,
  summarizeHarnessEvent,
} from '../src/harness/harnessFeedbackContext.js';

test('summarizes high-signal harness events for Pi prompt feedback', () => {
  assert.equal(
    summarizeHarnessEvent({
      type: 'memory.reflection_evaluated',
      taskId: 'task_1',
      memoryId: 'mem_1',
      gate: { status: 'promotable' },
    }),
    'task_1 memory mem_1 is promotable',
  );

  assert.equal(
    summarizeHarnessEvent({
      type: 'swarm.orchestration_completed',
      taskId: 'task_2',
      archivedChampion: { attemptId: 'attempt_a' },
    }),
    'task_2 swarm champion attempt_a is ready for approval',
  );
});

test('feedback buffer keeps recent high-signal events and ignores noisy events', () => {
  const feedback = createHarnessFeedbackBuffer({ maxItems: 3 });

  feedback.record({ type: 'budget.updated', taskId: 'task_noise' });
  feedback.record({ type: 'graph.context_composed', taskId: 'task_1', itemCount: 3 });
  feedback.record({
    type: 'capabilities.runtime_mounted',
    taskId: 'task_caps',
    manifestPath: 'C:\\repo\\.harness\\runtime\\capabilities.mount.json',
    enabledCounts: { skill: 1, mcp: 1, pi_extension: 0, profile: 0 },
  });
  feedback.record({ type: 'experiment.decision_written', taskId: 'task_2', decision: { conclusion: 'accept' } });
  feedback.record({ type: 'memory.corpus_scored', taskId: 'task_3', averageScore: 100, promotableCount: 1 });

  assert.deepEqual(feedback.items().map((item) => item.type), [
    'capabilities.runtime_mounted',
    'experiment.decision_written',
    'memory.corpus_scored',
  ]);
});

test('applies compact harness context to prompts and drains consumed items', () => {
  const feedback = createHarnessFeedbackBuffer();
  feedback.record({ type: 'bes.recombination_proposed', taskId: 'task_1', genome: { id: 'genome_a' } });
  feedback.record({ type: 'graph.context_composed', taskId: 'task_1', itemCount: 2 });
  feedback.record({
    type: 'capabilities.runtime_mounted',
    taskId: 'task_1',
    manifestPath: 'C:\\repo\\.harness\\runtime\\capabilities.mount.json',
    enabledCounts: { skill: 2, mcp: 1, pi_extension: 1, profile: 0 },
  });

  const prompt = applyHarnessFeedbackToPrompt({
    message: 'what should I do next?',
    feedback,
  });

  assert.match(prompt, /^\[Helios Harness Context\]/);
  assert.match(prompt, /task_1 recombined BES genome genome_a/);
  assert.match(prompt, /task_1 scoped capabilities mounted from C:\\repo\\.harness\\runtime\\capabilities.mount.json/);
  assert.match(prompt, /2 skill, 1 mcp, 1 pi_extension, 0 profile/);
  assert.match(prompt, /User request:\nwhat should I do next\?/);
  assert.equal(feedback.items().length, 0);
});

test('leaves prompt unchanged when feedback is empty or disabled', () => {
  const feedback = createHarnessFeedbackBuffer();
  feedback.record({ type: 'graph.context_composed', taskId: 'task_1', itemCount: 1 });

  assert.equal(applyHarnessFeedbackToPrompt({ message: 'plain', feedback: createHarnessFeedbackBuffer() }), 'plain');
  assert.equal(applyHarnessFeedbackToPrompt({ message: 'plain', feedback, enabled: false }), 'plain');
});
