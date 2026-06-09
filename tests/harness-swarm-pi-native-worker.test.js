import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSwarmA2AEnvelope } from '../src/harness-sidecar/interop/a2aSwarmEnvelope.js';
import { runPiNativeAttempt } from '../src/harness-sidecar/swarm/piNativeWorker.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

test('swarm A2A envelope scopes subagent role context budget and output contract', () => {
  const envelope = buildSwarmA2AEnvelope({
    task: { taskId: 'task_a2a', task: 'Patch the swarm UI' },
    attempt: {
      attemptId: 'attempt_a',
      strategy: 'ui_trace_slice',
      planning: { source: 'bes_evolution', goalId: 'goal_trace' },
    },
    role: 'implementer',
    context: {
      allowedFiles: ['public/app.js'],
      secret: 'do-not-send',
    },
    budget: { maxOutputChars: 1200, toolCalls: 3 },
    outputContract: { requiredFields: ['summary', 'verifierEvidence'] },
  });

  assert.equal(envelope.protocol, 'a2a');
  assert.equal(envelope.message.kind, 'swarm_attempt');
  assert.equal(envelope.message.taskId, 'task_a2a');
  assert.equal(envelope.message.attemptId, 'attempt_a');
  assert.equal(envelope.message.role, 'implementer');
  assert.deepEqual(envelope.message.context.allowedFiles, ['public/app.js']);
  assert.equal(JSON.stringify(envelope).includes('do-not-send'), false);
  assert.equal(envelope.message.outputContract.requiredFields.includes('summary'), true);
  assert.equal(envelope.message.planning.goalId, 'goal_trace');
});

test('swarm A2A envelope tolerates null optional sections', () => {
  const envelope = buildSwarmA2AEnvelope({
    task: null,
    attempt: null,
    context: null,
    budget: null,
    outputContract: null,
  });

  assert.equal(envelope.message.taskId, 'task_swarm');
  assert.equal(envelope.message.attemptId, 'attempt_1');
  assert.deepEqual(envelope.message.context.allowedFiles, []);
  assert.deepEqual(envelope.message.budget, {});
  assert.deepEqual(envelope.message.outputContract.requiredFields, []);
});

test('pi native worker emits trace events and normalizes final compact handoff', async () => {
  const calls = [];
  const emitted = [];
  const result = await runPiNativeAttempt({
    task: { taskId: 'task_pi_native', task: 'Implement Pi-native swarm worker' },
    attempt: { attemptId: 'attempt_pi', strategy: 'pi_native_worker' },
    role: 'implementer',
    context: { allowedFiles: ['src/harness-sidecar/swarm/piNativeWorker.js'] },
    budget: { maxOutputChars: 1000 },
    outputContract: { requiredFields: ['summary', 'verifierEvidence'] },
    emitTrace: (event) => emitted.push(event),
    piWorkerFactory: async () => ({
      start: async () => calls.push('start'),
      sendCommand: async (command) => {
        calls.push(command.type);
        assert.equal(command.type, 'prompt');
        assert.equal(command.a2a.message.attemptId, 'attempt_pi');
        return {
          success: true,
          data: {
            summary: 'Pi worker implemented a local adapter.',
            verifierEvidence: ['node --test tests/harness-swarm-pi-native-worker.test.js'],
            compactHandoff: {
              summary: 'Added Pi-native worker adapter.',
              filesInspected: ['src/harness-sidecar/swarm/piNativeWorker.js'],
              filesChanged: ['src/harness-sidecar/swarm/piNativeWorker.js'],
              testsRun: ['node --test tests/harness-swarm-pi-native-worker.test.js'],
              nextAction: 'Run focused swarm tests.',
              sourcePointers: ['piNativeWorker.js:runPiNativeAttempt'],
              risks: ['pi_native_disabled_by_default'],
            },
            thinkingSummary: 'Checked the role contract and returned verifier evidence.',
            score: 88,
          },
        };
      },
      stop: async () => calls.push('stop'),
    }),
  });

  assert.deepEqual(calls, ['start', 'prompt', 'stop']);
  assert.equal(result.status, 'completed');
  assert.equal(result.worker.kind, 'pi_native_subagent');
  assert.equal(result.thinkingSummary, 'Checked the role contract and returned verifier evidence.');
  assert.equal(result.compactHandoff.filesChanged.includes('src/harness-sidecar/swarm/piNativeWorker.js'), true);
  assert.equal(result.handoffQuality.status, 'acceptable');
  assert.deepEqual(
    emitted.map((event) => event.phase),
    ['planned', 'prompt_built', 'handoff_created'],
  );
});

test('swarm orchestrator can run Pi-native attempts behind explicit opt-in', async () => {
  const events = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_pi_swarm', task: 'Run Pi-native subagents' },
    taskType: 'coding_bugfix',
    maxAttempts: 1,
    context: { allowedFiles: ['src/harness-sidecar/swarm/piNativeWorker.js'] },
    budget: { maxOutputChars: 1000 },
    swarmExecution: { piNative: true, concurrency: 1 },
    piWorkerFactory: async () => ({
      start: async () => {},
      sendCommand: async () => ({
        success: true,
        data: {
          summary: 'Pi-native attempt completed.',
          verifierEvidence: ['focused verifier passed'],
          compactHandoff: {
            summary: 'Pi-native worker completed.',
            filesInspected: ['src/harness-sidecar/swarm/piNativeWorker.js'],
            filesChanged: ['src/harness-sidecar/swarm/piNativeWorker.js'],
            testsRun: ['node --test tests/harness-swarm-pi-native-worker.test.js'],
            nextAction: 'Review champion.',
            sourcePointers: ['swarmOrchestrator.js:runScheduledAttempt'],
            risks: ['fake_worker_only'],
          },
        },
      }),
      stop: async () => {},
    }),
    onAttemptEvent: (event) => events.push(event),
  });

  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].worker.kind, 'pi_native_subagent');
  assert.equal(events.some((event) => event.type === 'swarm.subagent_started' && event.worker.kind === 'pi_native_subagent'), true);
  assert.equal(events.some((event) => event.type === 'swarm.subagent_trace' && event.phase === 'handoff_created'), true);
  assert.equal(events.some((event) => event.type === 'swarm.subagent_completed' && event.worker.kind === 'pi_native_subagent'), true);
});
