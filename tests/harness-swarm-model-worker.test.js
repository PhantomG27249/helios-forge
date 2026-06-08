import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runModelDrivenAttempt } from '../src/harness-sidecar/swarm/modelDrivenWorker.js';

test('model-driven worker calls injected gateway with structured role prompt and normalizes object output', async () => {
  const calls = [];
  const result = await runModelDrivenAttempt({
    task: { taskId: 'task_model_worker', goal: 'Implement a scoped patch.' },
    attempt: { attemptId: 'attempt_model_1', strategy: 'test_first' },
    role: 'implementer',
    context: {
      assignedFiles: ['src/harness-sidecar/swarm/modelDrivenWorker.js'],
      notes: ['Never run verifier commands from this worker.'],
    },
    budget: { tokens: 700, maxOutputChars: 2000 },
    profileName: 'critic_low_temp',
    modelGateway: {
      call: async (input) => {
        calls.push(input);
        return {
          callId: 'model_call_1',
          profile: { name: 'critic_low_temp', model: 'critic-model' },
          usage: { inputTokens: 33, outputTokens: 11, totalTokens: 44 },
          structured: {
            summary: 'Adds the model-driven worker adapter.',
            patch: 'diff --git a/src/harness-sidecar/swarm/modelDrivenWorker.js b/src/harness-sidecar/swarm/modelDrivenWorker.js',
            verifierEvidence: ['node --test tests/harness-swarm-model-worker.test.js'],
            verifierCommands: ['node --test tests/harness-swarm-model-worker.test.js'],
            score: 91,
            artifacts: [{ path: 'artifact.txt', type: 'text' }],
            risks: ['Needs orchestrator wiring later.'],
          },
        };
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].structuredOutput, true);
  assert.equal(calls[0].taskId, 'task_model_worker');
  assert.equal(calls[0].purpose, 'swarm_model_worker');
  assert.equal(calls[0].profileName, 'critic_low_temp');
  assert.match(calls[0].messages.map((message) => message.content).join('\n'), /Role: Implementer/);
  assert.match(calls[0].messages.map((message) => message.content).join('\n'), /Required output fields: summary, patch or verifierEvidence/);
  assert.match(calls[0].messages.map((message) => message.content).join('\n'), /Never run verifier commands/);

  assert.equal(result.attemptId, 'attempt_model_1');
  assert.equal(result.role, 'implementer');
  assert.equal(result.strategy, 'test_first');
  assert.equal(result.status, 'completed');
  assert.equal(result.summary, 'Adds the model-driven worker adapter.');
  assert.match(result.patch, /diff --git/);
  assert.deepEqual(result.verifierEvidence, ['node --test tests/harness-swarm-model-worker.test.js']);
  assert.deepEqual(result.verifierCommands, ['node --test tests/harness-swarm-model-worker.test.js']);
  assert.equal(result.score, 91);
  assert.deepEqual(result.artifacts, [{ path: 'artifact.txt', type: 'text' }]);
  assert.deepEqual(result.risks, ['Needs orchestrator wiring later.']);
  assert.deepEqual(result.compactHandoff, {
    summary: 'Adds the model-driven worker adapter.',
    filesInspected: [],
    filesChanged: ['src/harness-sidecar/swarm/modelDrivenWorker.js'],
    commandsRun: [],
    testsRun: ['node --test tests/harness-swarm-model-worker.test.js'],
    blocker: null,
    nextAction: null,
    sourcePointers: [],
    uncertainty: [],
    risks: ['Needs orchestrator wiring later.'],
  });
  assert.equal(result.handoffQuality.score, 65);
  assert.deepEqual(result.handoffQuality.findings, [
    'missing_files_inspected',
    'missing_blocker_or_next_action',
    'missing_source_pointers',
  ]);
  assert.deepEqual(result.model, {
    callId: 'model_call_1',
    profileName: 'critic_low_temp',
    model: 'critic-model',
    usage: { inputTokens: 33, outputTokens: 11, totalTokens: 44 },
  });
});

test('model-driven worker accepts provider JSON string output and verifier-only evidence', async () => {
  const providerCalls = [];
  const result = await runModelDrivenAttempt({
    task: { taskId: 'task_model_worker_verify', goal: 'Inspect a candidate.' },
    attempt: { attemptId: 'attempt_model_2', strategy: 'verifier_pass' },
    role: 'verifier',
    provider: async (input) => {
      providerCalls.push(input);
      return JSON.stringify({
        summary: 'Verifier inspected the patch and found no missing evidence.',
        verifierEvidence: ['inspected diff headers and focused test command'],
        score: '73',
      });
    },
  });

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].structuredOutput, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.patch, '');
  assert.deepEqual(result.verifierEvidence, ['inspected diff headers and focused test command']);
  assert.equal(result.score, 73);
  assert.deepEqual(result.artifacts, []);
});

test('model-driven worker rejects malformed model output with clear contract error', async () => {
  await assert.rejects(
    runModelDrivenAttempt({
      task: { taskId: 'task_model_worker_bad', goal: 'Return malformed output.' },
      attempt: { attemptId: 'attempt_model_3', strategy: 'bad_contract' },
      modelGateway: {
        call: async () => ({
          structured: {
            patch: 'diff --git a/file b/file',
            verifierCommands: ['node --test should-not-run.test.js'],
          },
        }),
      },
    }),
    /Malformed model worker output: missing summary/,
  );

  await assert.rejects(
    runModelDrivenAttempt({
      task: { taskId: 'task_model_worker_bad_2', goal: 'Return no useful attempt payload.' },
      attempt: { attemptId: 'attempt_model_4', strategy: 'bad_contract' },
      provider: async () => '{"summary":"No patch or evidence."}',
    }),
    /Malformed model worker output: expected patch or verifierEvidence/,
  );
});

test('model-driven worker rejects tool calls instead of executing them', async () => {
  await assert.rejects(
    runModelDrivenAttempt({
      task: { taskId: 'task_model_worker_tools', goal: 'Try to call a shell.' },
      attempt: { attemptId: 'attempt_model_5', strategy: 'unsafe_tool_call' },
      provider: async () => ({
        summary: 'I will run a command.',
        patch: '',
        verifierEvidence: ['planned command only'],
        toolCalls: [{ tool: 'shell.run', args: { command: 'node --test' } }],
      }),
    }),
    /Model worker does not execute tool calls/,
  );
});

test('model-driven worker rejects tool calls on the gateway response envelope', async () => {
  await assert.rejects(
    runModelDrivenAttempt({
      task: { taskId: 'task_model_worker_envelope_tools', goal: 'Try to hide a tool call.' },
      attempt: { attemptId: 'attempt_model_6', strategy: 'unsafe_envelope_tool_call' },
      modelGateway: {
        call: async () => ({
          toolCalls: [{ tool: 'shell.run', args: { command: 'node --test' } }],
          structured: {
            summary: 'The structured payload looks fine.',
            patch: 'diff --git a/file b/file',
          },
        }),
      },
    }),
    /Model worker does not execute tool calls/,
  );
});
