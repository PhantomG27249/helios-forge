import assert from 'node:assert/strict';
import { test } from 'node:test';

import { McpClient } from '../src/harness-sidecar/tools/mcpClient.js';
import { McpRuntimeRegistry } from '../src/harness-sidecar/tools/mcpRuntime.js';

function createSendTransport(handler) {
  const requests = [];
  return {
    requests,
    async send(request) {
      requests.push(request);
      return handler(request);
    },
  };
}

test('MCP client initializes, lists tools, and calls tools over send transport', async () => {
  const transport = createSendTransport(async (request) => {
    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'demo', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      };
    }
    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
            {
              name: 'demo.echo',
              description: 'Echo input',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
              },
            },
          ],
        },
      };
    }
    if (request.method === 'tools/call') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: request.params.arguments.text }],
          isError: false,
        },
      };
    }
    throw new Error(`unexpected method ${request.method}`);
  });
  const client = new McpClient({ transport, clientInfo: { name: 'helios-test', version: '0.0.0' } });

  const init = await client.initialize();
  const tools = await client.listTools();
  const result = await client.callTool('demo.echo', { text: 'hello' });

  assert.equal(init.serverInfo.name, 'demo');
  assert.equal(tools[0].name, 'demo.echo');
  assert.deepEqual(result.content, [{ type: 'text', text: 'hello' }]);
  assert.deepEqual(
    transport.requests.map((request) => request.method),
    ['initialize', 'tools/list', 'tools/call'],
  );
  assert.equal(transport.requests[2].params.name, 'demo.echo');
});

test('MCP client supports request-style transports', async () => {
  const calls = [];
  const transport = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'tools/list') {
        return {
          tools: [
            {
              name: 'fs.read',
              inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
            },
          ],
        };
      }
      return {};
    },
  };
  const client = new McpClient({ transport });

  const tools = await client.listTools();

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'fs.read');
  assert.equal(calls[0].method, 'tools/list');
});

test('MCP client rejects malformed list tools and call tool payloads', async () => {
  const listClient = new McpClient({
    transport: createSendTransport(async (request) => ({
      jsonrpc: '2.0',
      id: request.id,
      result: { tools: [{ description: 'missing name', inputSchema: { type: 'object' } }] },
    })),
  });
  const callClient = new McpClient({
    transport: createSendTransport(async (request) => ({
      jsonrpc: '2.0',
      id: request.id,
      result: { content: [{ text: 'missing type' }] },
    })),
  });

  await assert.rejects(() => listClient.listTools(), /invalid MCP tools\/list response/i);
  await assert.rejects(() => callClient.callTool('bad.tool', {}), /invalid MCP tools\/call response/i);
});

test('MCP runtime starts configured servers, reports status, and stops transports', async () => {
  const stopped = [];
  const runtime = new McpRuntimeRegistry({
    servers: [{ id: 'local', command: 'not-spawned-yet' }],
    transportFactory: ({ server }) => ({
      async request(method) {
        if (method === 'initialize') {
          return { serverInfo: { name: server.id, version: '1.0.0' }, capabilities: { tools: {} } };
        }
        if (method === 'tools/list') {
          return { tools: [{ name: 'local.echo', inputSchema: { type: 'object' } }] };
        }
        return {};
      },
      async close() {
        stopped.push(server.id);
      },
    }),
  });

  const started = await runtime.start('local');
  const tools = await runtime.listTools('local');
  const stoppedStatus = await runtime.stop('local');

  assert.equal(started.status, 'running');
  assert.equal(runtime.status('local').status, 'stopped');
  assert.equal(tools[0].serverId, 'local');
  assert.equal(tools[0].name, 'local.echo');
  assert.deepEqual(stopped, ['local']);
  assert.equal(stoppedStatus.status, 'stopped');
});

test('MCP runtime applies policy gate before tool calls and records audit entries', async () => {
  let remoteCalls = 0;
  const runtime = new McpRuntimeRegistry({
    servers: [{ id: 'github' }],
    transportFactory: () => ({
      async request(method) {
        if (method === 'initialize') return { serverInfo: { name: 'github' }, capabilities: { tools: {} } };
        if (method === 'tools/call') {
          remoteCalls += 1;
          return { content: [{ type: 'text', text: 'merged' }], isError: false };
        }
        return { tools: [] };
      },
    }),
    policy: ({ serverId, tool, args }) => {
      assert.equal(serverId, 'github');
      assert.equal(tool, 'github.merge_pr');
      assert.deepEqual(args, { pr: 12 });
      return { status: 'blocked', reason: 'merge needs approval' };
    },
  });
  await runtime.start('github');

  const result = await runtime.callTool('github', 'github.merge_pr', { pr: 12 });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'merge needs approval');
  assert.equal(remoteCalls, 0);
  assert.equal(runtime.auditEntries.length, 2);
  assert.equal(runtime.auditEntries.at(-1).type, 'mcp.tool.blocked');
});

test('MCP runtime enforces per-call timeout and audits failed calls', async () => {
  const runtime = new McpRuntimeRegistry({
    servers: [{ id: 'slow' }],
    callTimeoutMs: 25,
    transportFactory: () => ({
      async request(method) {
        if (method === 'initialize') return { serverInfo: { name: 'slow' }, capabilities: { tools: {} } };
        if (method === 'tools/call') {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { content: [{ type: 'text', text: 'late' }] };
        }
        return { tools: [] };
      },
    }),
  });
  await runtime.start('slow');

  await assert.rejects(() => runtime.callTool('slow', 'slow.wait', {}), /timed out/i);
  assert.equal(runtime.auditEntries.at(-1).type, 'mcp.tool.failed');
});
