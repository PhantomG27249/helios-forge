import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

async function loadSubject() {
  return import('../src/harness-sidecar/tools/mcpCapabilityRuntime.js');
}

function collectEvents() {
  const events = [];
  return {
    events,
    emitEvent(event) {
      events.push(event);
    },
  };
}

test('starts only enabled MCP stdio records with workspace-relative cwd resolved', async () => {
  const { startMcpRuntimesFromCapabilities } = await loadSubject();
  const calls = [];
  const workspaceRoot = path.join('C:', 'workspace', 'project');
  const { events, emitEvent } = collectEvents();
  const runtime = {
    async startServer(id, config) {
      calls.push({ id, config });
      return { serverId: id, status: 'running' };
    },
  };

  const summary = await startMcpRuntimesFromCapabilities({
    workspaceRoot,
    runtime,
    emitEvent,
    records: [
      { id: 'disabled', type: 'mcp', enabled: false, command: 'node' },
      { id: 'skill', type: 'skill', enabled: true, command: 'node' },
      {
        id: 'local-tools',
        name: 'Local Tools',
        type: 'mcp',
        enabled: true,
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        cwd: 'tools/local',
        env: {
          MODE: 'test',
          API_TOKEN: 'secret-token',
        },
      },
    ],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'local-tools');
  assert.deepEqual(calls[0].config, {
    id: 'local-tools',
    name: 'Local Tools',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    cwd: path.resolve(workspaceRoot, 'tools/local'),
    env: {
      MODE: 'test',
      API_TOKEN: 'secret-token',
    },
  });
  assert.deepEqual(summary.started, [
    {
      id: 'local-tools',
      transport: 'stdio',
      status: 'started',
    },
  ]);
  assert.deepEqual(summary.skipped, []);
  assert.equal(summary.runtime, runtime);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'mcp.capability_runtime.started',
    id: 'local-tools',
    transport: 'stdio',
    status: 'started',
  });
});

test('starts URL based SSE and HTTP records without stdio fields', async () => {
  const { startMcpRuntimesFromCapabilities } = await loadSubject();
  const calls = [];
  const runtime = {
    async startServer(id, config) {
      calls.push({ id, config });
      return { serverId: id, status: 'running' };
    },
  };

  const summary = await startMcpRuntimesFromCapabilities({
    workspaceRoot: 'C:\\workspace\\project',
    runtime,
    records: [
      {
        id: 'events',
        type: 'mcp',
        enabled: true,
        transport: 'sse',
        url: 'https://example.test/sse',
        command: 'should-not-be-used-for-url-transport',
      },
      {
        id: 'http-tools',
        type: 'mcp',
        enabled: true,
        transport: 'http',
        url: 'https://example.test/mcp',
      },
    ],
  });

  assert.deepEqual(calls, [
    {
      id: 'events',
      config: {
        id: 'events',
        name: 'events',
        transport: 'sse',
        url: 'https://example.test/sse',
      },
    },
    {
      id: 'http-tools',
      config: {
        id: 'http-tools',
        name: 'http-tools',
        transport: 'http',
        url: 'https://example.test/mcp',
      },
    },
  ]);
  assert.deepEqual(summary.started.map((entry) => entry.id), ['events', 'http-tools']);
  assert.deepEqual(summary.skipped, []);
});

test('skips enabled MCP records missing startup config and emits unavailable event', async () => {
  const { startMcpRuntimesFromCapabilities } = await loadSubject();
  const calls = [];
  const { events, emitEvent } = collectEvents();
  const runtime = {
    async startServer(id, config) {
      calls.push({ id, config });
      return { serverId: id, status: 'running' };
    },
  };

  const summary = await startMcpRuntimesFromCapabilities({
    workspaceRoot: 'C:\\workspace\\project',
    runtime,
    emitEvent,
    records: [
      { id: 'missing', type: 'mcp', enabled: true, name: 'Missing Config' },
      { id: 'url-missing', type: 'mcp', enabled: true, transport: 'sse' },
      { id: 'command-missing', type: 'mcp', enabled: true, transport: 'stdio' },
    ],
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(summary.started, []);
  assert.deepEqual(summary.skipped, [
    {
      id: 'missing',
      transport: null,
      status: 'skipped',
      reason: 'missing_startup_config',
    },
    {
      id: 'url-missing',
      transport: 'sse',
      status: 'skipped',
      reason: 'missing_url',
    },
    {
      id: 'command-missing',
      transport: 'stdio',
      status: 'skipped',
      reason: 'missing_command',
    },
  ]);
  assert.deepEqual(events, [
    {
      type: 'mcp.capability_runtime.unavailable',
      id: 'missing',
      transport: null,
      status: 'skipped',
      reason: 'missing_startup_config',
    },
    {
      type: 'mcp.capability_runtime.unavailable',
      id: 'url-missing',
      transport: 'sse',
      status: 'skipped',
      reason: 'missing_url',
    },
    {
      type: 'mcp.capability_runtime.unavailable',
      id: 'command-missing',
      transport: 'stdio',
      status: 'skipped',
      reason: 'missing_command',
    },
  ]);
});

test('skips missing-config records without requiring an injected runtime', async () => {
  const { startMcpRuntimesFromCapabilities } = await loadSubject();
  const { events, emitEvent } = collectEvents();

  const summary = await startMcpRuntimesFromCapabilities({
    workspaceRoot: 'C:\\workspace\\project',
    emitEvent,
    records: [
      { id: 'missing', type: 'mcp', enabled: true },
    ],
  });

  assert.deepEqual(summary.started, []);
  assert.deepEqual(summary.skipped, [
    {
      id: 'missing',
      transport: null,
      status: 'skipped',
      reason: 'missing_startup_config',
    },
  ]);
  assert.equal(summary.runtime, undefined);
  assert.deepEqual(events, [
    {
      type: 'mcp.capability_runtime.unavailable',
      id: 'missing',
      transport: null,
      status: 'skipped',
      reason: 'missing_startup_config',
    },
  ]);
});

test('instantiates McpRuntimeRegistry when runtime is omitted and transportFactory is provided', async () => {
  const { startMcpRuntimesFromCapabilities } = await loadSubject();
  const factoryCalls = [];

  const summary = await startMcpRuntimesFromCapabilities({
    workspaceRoot: 'C:\\workspace\\project',
    transportFactory({ server, serverId }) {
      factoryCalls.push({ server, serverId });
      return {
        async request(method) {
          if (method === 'initialize') {
            return { serverInfo: { name: serverId }, capabilities: { tools: {} } };
          }
          return {};
        },
      };
    },
    records: [
      {
        id: 'auto-runtime',
        type: 'mcp',
        enabled: true,
        command: 'node',
        args: 'server.js',
      },
    ],
  });

  assert.equal(summary.runtime.constructor.name, 'McpRuntimeRegistry');
  assert.equal(summary.runtime.status('auto-runtime').status, 'running');
  assert.deepEqual(summary.started, [
    {
      id: 'auto-runtime',
      transport: 'stdio',
      status: 'started',
    },
  ]);
  assert.equal(factoryCalls.length, 1);
  assert.equal(factoryCalls[0].serverId, 'auto-runtime');
  assert.equal(factoryCalls[0].server.command, 'node');
  assert.deepEqual(factoryCalls[0].server.args, ['server.js']);
});

test('does not leak secret env values into summaries or emitted events', async () => {
  const { startMcpRuntimesFromCapabilities } = await loadSubject();
  const { events, emitEvent } = collectEvents();
  const runtime = {
    async startServer(id) {
      return { serverId: id, status: 'running' };
    },
  };

  const summary = await startMcpRuntimesFromCapabilities({
    workspaceRoot: 'C:\\workspace\\project',
    runtime,
    emitEvent,
    records: [
      {
        id: 'secret-server',
        type: 'mcp',
        enabled: true,
        command: 'node',
        env: {
          OPENAI_API_KEY: 'sk-real-value',
          VISIBLE: 'safe',
        },
      },
    ],
  });

  const serializedPublicOutput = JSON.stringify({ events, summary });

  assert.equal(serializedPublicOutput.includes('sk-real-value'), false);
  assert.equal(serializedPublicOutput.includes('OPENAI_API_KEY'), false);
  assert.equal(serializedPublicOutput.includes('VISIBLE'), false);
  assert.equal(serializedPublicOutput.includes('safe'), false);
});
