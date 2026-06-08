import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runSwarmAttemptsBounded } from '../src/harness-sidecar/swarm/swarmExecutor.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

test('bounded executor starts attempts up to the concurrency limit', async () => {
  const releases = [deferred(), deferred(), deferred()];
  const started = [];
  const runningCounts = [];
  let running = 0;

  const run = runSwarmAttemptsBounded({
    attempts: [{ attemptId: 'a' }, { attemptId: 'b' }, { attemptId: 'c' }],
    concurrency: 2,
    runAttempt: async ({ attempt, index }) => {
      started.push(attempt.attemptId);
      running += 1;
      runningCounts.push(running);
      await releases[index].promise;
      running -= 1;
      return { attemptId: attempt.attemptId, status: 'completed' };
    },
  });

  await Promise.resolve();
  assert.deepEqual(started, ['a', 'b']);
  assert.equal(Math.max(...runningCounts), 2);
  releases[1].resolve();
  await Promise.resolve();
  releases[0].resolve();
  releases[2].resolve();
  await run;
});

test('bounded executor permits out-of-order completion but returns deterministic rank order', async () => {
  const completionOrder = [];
  const result = await runSwarmAttemptsBounded({
    attempts: [{ attemptId: 'a' }, { attemptId: 'b' }, { attemptId: 'c' }],
    concurrency: 3,
    runAttempt: async ({ attempt }) => {
      if (attempt.attemptId === 'a') await new Promise((resolve) => setTimeout(resolve, 20));
      completionOrder.push(attempt.attemptId);
      return { attemptId: attempt.attemptId, status: 'completed' };
    },
  });

  assert.notDeepEqual(completionOrder, ['a', 'b', 'c']);
  assert.deepEqual(result.map((attempt) => attempt.attemptId), ['a', 'b', 'c']);
});

test('bounded executor records failures without stopping other attempts', async () => {
  const result = await runSwarmAttemptsBounded({
    attempts: [{ attemptId: 'a' }, { attemptId: 'b' }, { attemptId: 'c' }],
    concurrency: 2,
    runAttempt: async ({ attempt }) => {
      if (attempt.attemptId === 'b') throw new Error('provider timeout');
      return { attemptId: attempt.attemptId, status: 'completed' };
    },
  });

  assert.deepEqual(result.map((attempt) => attempt.status), ['completed', 'failed', 'completed']);
  assert.equal(result[1].failure.reason, 'attempt_failed');
  assert.match(result[1].failure.message, /provider timeout/);
});

test('bounded executor event stream includes started and completed for every attempt', async () => {
  const events = [];
  await runSwarmAttemptsBounded({
    attempts: [{ attemptId: 'a' }, { attemptId: 'b' }],
    concurrency: 2,
    onAttemptEvent: async (event) => events.push(event),
    runAttempt: async ({ attempt }) => ({ attemptId: attempt.attemptId, status: 'completed' }),
  });

  assert.deepEqual(events.map((event) => `${event.type}:${event.attemptId}`), [
    'started:a',
    'started:b',
    'completed:a',
    'completed:b',
  ]);
});

test('orchestrator preserves sequential default and uses bounded concurrency only when enabled', async () => {
  const sequentialCalls = [];
  await orchestrateSwarm({
    task: { taskId: 'task_seq_default' },
    maxAttempts: 2,
    commandAdapter: async ({ attempt }) => {
      sequentialCalls.push(attempt.attemptId);
      return { patch: attempt.attemptId, verifierEvidence: ['ok'] };
    },
  });
  assert.deepEqual(sequentialCalls, ['attempt_1', 'attempt_2']);

  const releases = { attempt_1: deferred(), attempt_2: deferred() };
  const started = [];
  const run = orchestrateSwarm({
    task: { taskId: 'task_parallel_enabled' },
    maxAttempts: 2,
    swarmExecution: { concurrency: 2 },
    commandAdapter: async ({ attempt }) => {
      started.push(attempt.attemptId);
      await releases[attempt.attemptId].promise;
      return { patch: attempt.attemptId, verifierEvidence: ['ok'] };
    },
  });

  await Promise.resolve();
  assert.deepEqual(started, ['attempt_1', 'attempt_2']);
  releases.attempt_2.resolve();
  releases.attempt_1.resolve();
  const result = await run;
  assert.deepEqual(result.attempts.map((attempt) => attempt.attemptId), ['attempt_1', 'attempt_2']);
});
