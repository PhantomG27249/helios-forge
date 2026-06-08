import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ModelGateway } from '../src/harness-sidecar/model/modelGateway.js';
import { createOpenAICompatibleProvider } from '../src/harness-sidecar/model/openaiCompatibleProvider.js';
import { parseToolCalls } from '../src/harness-sidecar/model/toolCallParser.js';
import { ToolRegistry } from '../src/harness-sidecar/tools/toolRegistry.js';
import { runToolLoop } from '../src/harness-sidecar/tools/toolLoopController.js';

test('tool loop returns final answer when model requests no tools', async () => {
  const result = await runToolLoop({
    taskId: 'task_final',
    modelGateway: {
      call: async () => ({ text: 'Final answer only.' }),
    },
    messages: [{ role: 'user', content: 'Answer directly.' }],
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'Final answer only.');
  assert.equal(result.iterations, 1);
  assert.deepEqual(result.toolResults, []);
});

test('tool loop executes one tool call and returns final follow-up answer', async () => {
  const calls = [];
  const registry = new ToolRegistry();
  registry.register({
    name: 'demo.echo',
    description: 'Echo a value',
    execute: async (args) => ({ echoed: args.value }),
  });
  const result = await runToolLoop({
    taskId: 'task_roundtrip',
    toolRegistry: registry,
    modelGateway: {
      call: async ({ messages }) => {
        calls.push(messages);
        if (calls.length === 1) {
          return {
            text: '',
            toolCalls: [{ id: 'call_1', name: 'demo.echo', args: { value: 'hello' } }],
          };
        }
        return { text: 'The tool said hello.' };
      },
    },
    messages: [{ role: 'user', content: 'Echo hello.' }],
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.finalText, 'The tool said hello.');
  assert.equal(result.iterations, 2);
  assert.deepEqual(result.toolResults, [
    {
      id: 'call_1',
      name: 'demo.echo',
      status: 'completed',
      result: { echoed: 'hello' },
    },
  ]);
  assert.equal(calls[1].at(-1).role, 'tool');
  assert.equal(calls[1].at(-1).tool_call_id, 'call_1');
});

test('OpenAI-compatible provider and parser preserve native tool_calls', async () => {
  const requests = [];
  const provider = createOpenAICompatibleProvider({
    baseUrl: 'http://model.test/v1',
    fetchImpl: async (url, request) => {
      requests.push({ url, request: JSON.parse(request.body) });
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: 'call_native',
                type: 'function',
                function: {
                  name: 'demo.lookup',
                  arguments: '{"query":"helios"}',
                },
              }],
            },
          }],
        }),
      };
    },
  });
  const gateway = new ModelGateway({ provider });

  const response = await gateway.call({
    taskId: 'task_native',
    purpose: 'tool_loop',
    profileName: 'critic_low_temp',
    messages: [{ role: 'user', content: 'Look up helios.' }],
    tools: [{ name: 'demo.lookup', inputSchema: { type: 'object' } }],
  });

  assert.equal(requests[0].request.tools[0].function.name, 'demo.lookup');
  assert.deepEqual(response.toolCalls, [
    { id: 'call_native', name: 'demo.lookup', args: { query: 'helios' } },
  ]);
  assert.deepEqual(parseToolCalls({ toolCalls: response.toolCalls }), response.toolCalls);
});

test('tool call parser extracts JSON fallback tool call from text', () => {
  const parsed = parseToolCalls({
    text: '```json\n{ "tool": "demo.echo", "args": { "value": "fallback" } }\n```',
  });

  assert.deepEqual(parsed, [
    { id: null, name: 'demo.echo', args: { value: 'fallback' } },
  ]);
});

test('tool loop reports unknown, blocked, and approval-required tool calls without executing them', async () => {
  const registry = new ToolRegistry();
  let executeCount = 0;
  registry.register({
    name: 'safe.echo',
    execute: async () => {
      executeCount += 1;
      return { ok: true };
    },
  });
  registry.register({
    name: 'needs.approval',
    requiresApproval: true,
    execute: async () => {
      executeCount += 1;
      return { ok: true };
    },
  });
  registry.register({
    name: 'blocked.tool',
    blocked: true,
    execute: async () => {
      executeCount += 1;
      return { ok: true };
    },
  });

  const result = await runToolLoop({
    taskId: 'task_gates',
    toolRegistry: registry,
    modelGateway: {
      call: async () => ({
        text: '',
        toolCalls: [
          { id: 'unknown', name: 'missing.tool', args: {} },
          { id: 'blocked', name: 'blocked.tool', args: {} },
          { id: 'approval', name: 'needs.approval', args: {} },
        ],
      }),
    },
    messages: [{ role: 'user', content: 'Try gated calls.' }],
  });

  assert.equal(result.status, 'blocked');
  assert.equal(executeCount, 0);
  assert.deepEqual(result.toolResults.map((item) => item.status), [
    'blocked',
    'blocked',
    'approval_required',
  ]);
});

test('tool loop stops when max iterations is reached', async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: 'demo.echo',
    execute: async (args) => args,
  });

  const result = await runToolLoop({
    taskId: 'task_max_iterations',
    maxIterations: 2,
    toolRegistry: registry,
    modelGateway: {
      call: async () => ({
        text: '',
        toolCalls: [{ id: 'again', name: 'demo.echo', args: { value: 'again' } }],
      }),
    },
    messages: [{ role: 'user', content: 'Loop forever.' }],
  });

  assert.equal(result.status, 'max_iterations');
  assert.equal(result.iterations, 2);
  assert.equal(result.toolResults.length, 2);
  assert.equal(result.finalText, '');
});
