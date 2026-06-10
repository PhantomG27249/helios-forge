import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createDefaultToolRegistry } from '../src/harness-sidecar/tools/defaultToolRegistry.js';

const BROWSER_TOOL_NAMES = [
  'browser.session.create',
  'browser.navigate',
  'browser.screenshot',
  'browser.console.read',
  'browser.network.summary',
  'browser.dom.snapshot',
  'browser.session.close',
];

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-browser-tools-'));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('default tool registry registers policy-gated browser tools', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      browserRuntime: {
        async createSession() {
          return { status: 'created', sessionId: 'browser_task_1' };
        },
      },
    });

    const names = registry.list().map((tool) => tool.name);

    for (const name of BROWSER_TOOL_NAMES) {
      assert.equal(names.includes(name), true, `${name} should be registered`);
    }
  });
});

test('browser tools call the injected runtime without constructing raw browser handles', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const calls = [];
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      browserRuntime: {
        async createSession(args) {
          calls.push(['createSession', args]);
          return { status: 'created', sessionId: 'browser_task_runtime_1' };
        },
        async navigate(args) {
          calls.push(['navigate', args]);
          return { status: 'navigated', url: args.url };
        },
        async consoleRead(args) {
          calls.push(['consoleRead', args]);
          return { status: 'completed', entries: [{ type: 'log', text: 'ready' }] };
        },
        async domSnapshot(args) {
          calls.push(['domSnapshot', args]);
          return { status: 'completed', snapshot: { text: 'Preview ready', roles: ['main'] } };
        },
        async closeSession(args) {
          calls.push(['closeSession', args]);
          return { status: 'closed', sessionId: args.sessionId };
        },
      },
    });

    const created = await registry.execute('browser.session.create', {
      taskId: 'task_runtime',
      viewport: { width: 800, height: 600 },
    });
    await registry.execute('browser.navigate', {
      sessionId: created.sessionId,
      url: 'http://127.0.0.1:5173/',
    });
    await registry.execute('browser.console.read', { sessionId: created.sessionId });
    await registry.execute('browser.dom.snapshot', { sessionId: created.sessionId });
    await registry.execute('browser.session.close', { sessionId: created.sessionId });

    assert.deepEqual(calls.map(([method]) => method), [
      'createSession',
      'navigate',
      'consoleRead',
      'domSnapshot',
      'closeSession',
    ]);
    assert.deepEqual(calls[0][1], {
      taskId: 'task_runtime',
      viewport: { width: 800, height: 600 },
    });
  });
});

test('browser session create ignores caller allowedOrigins for navigation policy', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const runtimeCalls = [];
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      browserRuntime: {
        async createSession(args) {
          runtimeCalls.push(['createSession', args]);
          return { status: 'created', sessionId: 'browser_task_model_policy_1' };
        },
        async navigate(args) {
          runtimeCalls.push(['navigate', args]);
          return { status: 'navigated', url: args.url };
        },
      },
    });

    const created = await registry.execute('browser.session.create', {
      taskId: 'task_model_policy',
      allowedOrigins: ['https://example.com'],
    });
    const result = await registry.execute('browser.navigate', {
      sessionId: created.sessionId,
      url: 'https://example.com/private',
    });

    assert.equal(result.status, 'denied');
    assert.equal(result.kind, 'policy');
    assert.equal(result.reason, 'external_origin_not_allowlisted');
    assert.deepEqual(runtimeCalls.map(([method]) => method), ['createSession']);
    assert.equal('allowedOrigins' in runtimeCalls[0][1], false);
  });
});

test('browser navigate returns structured policy failures for denied URLs', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const runtimeCalls = [];
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      browserPolicy: {
        validateUrl({ url }) {
          return {
            allowed: false,
            reason: 'external_origin_not_allowed',
            sanitizedUrl: url,
          };
        },
      },
      browserRuntime: {
        async navigate(args) {
          runtimeCalls.push(args);
          return { status: 'navigated' };
        },
      },
    });

    const result = await registry.execute('browser.navigate', {
      sessionId: 'browser_task_denied_1',
      url: 'https://example.com/?token=secret',
    });

    assert.equal(result.status, 'denied');
    assert.equal(result.kind, 'policy');
    assert.equal(result.reason, 'external_origin_not_allowed');
    assert.deepEqual(runtimeCalls, []);
  });
});

test('browser dom snapshot redacts secrets and clamps requested text length to default ceiling', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      browserRuntime: {
        async domSnapshot() {
          return {
            status: 'completed',
            snapshot: {
              text: `before password=supersecret token=abc123 authorization: Bearer abc cookie=sid123 api_key=key123 ${'x'.repeat(20000)}`,
              roles: ['main'],
            },
          };
        },
      },
    });

    const result = await registry.execute('browser.dom.snapshot', {
      sessionId: 'browser_task_dom_1',
      maxTextChars: 1000000,
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.text.length <= 12000, true);
    assert.equal(result.text.includes('password=supersecret'), false);
    assert.equal(result.text.includes('token=abc123'), false);
    assert.equal(result.text.includes('authorization:'), false);
    assert.equal(result.text.includes('cookie=sid123'), false);
    assert.equal(result.text.includes('api_key=key123'), false);
  });
});

test('browser console read redacts secret-looking text', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      browserRuntime: {
        async consoleRead() {
          return {
            status: 'completed',
            entries: [{
              type: 'error',
              text: 'failed password=supersecret token=abc123 authorization: Bearer abc cookie=sid123 api_key=key123',
            }],
          };
        },
      },
    });

    const result = await registry.execute('browser.console.read', {
      sessionId: 'browser_task_console_1',
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.entries[0].text.includes('password=supersecret'), false);
    assert.equal(result.entries[0].text.includes('token=abc123'), false);
    assert.equal(result.entries[0].text.includes('authorization:'), false);
    assert.equal(result.entries[0].text.includes('cookie=sid123'), false);
    assert.equal(result.entries[0].text.includes('api_key=key123'), false);
  });
});

test('browser screenshot tool resolves artifacts under the task browser directory', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const screenshotCalls = [];
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      browserRuntime: {
        async screenshot(args) {
          screenshotCalls.push(args);
          return { status: 'captured', path: args.outputPath, width: 640, height: 480 };
        },
      },
    });

    const result = await registry.execute('browser.screenshot', {
      taskId: 'task_screenshot',
      sessionId: 'browser_task_screenshot_1',
      filename: 'after.png',
    });

    const expectedPath = path.join(workspaceRoot, '.harness', 'browser', 'task_screenshot', 'after.png');
    const expectedRelativePath = path.join('.harness', 'browser', 'task_screenshot', 'after.png');
    assert.equal(screenshotCalls.length, 1);
    assert.equal(screenshotCalls[0].outputPath, expectedPath);
    assert.equal(result.outputPath, expectedPath);
    assert.equal(result.artifact.path, expectedRelativePath);
  });
});

test('browser network summary redacts sensitive headers and omits bodies', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      browserRuntime: {
        async networkSummary() {
          return {
            status: 'completed',
            records: [{
              url: 'http://127.0.0.1:5173/api?token=secret#debug',
              method: 'GET',
              requestHeaders: {
                authorization: 'Bearer secret',
                cookie: 'session=secret',
                accept: 'application/json',
              },
              responseHeaders: {
                'set-cookie': 'session=secret',
                'content-type': 'application/json',
              },
              requestBody: 'secret body',
              responseBody: 'secret response',
            }],
          };
        },
      },
    });

    const result = await registry.execute('browser.network.summary', {
      sessionId: 'browser_task_network_1',
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.records[0].url, 'http://127.0.0.1:5173/api');
    assert.equal(result.records[0].requestHeaders.authorization, '[redacted]');
    assert.equal(result.records[0].requestHeaders.cookie, '[redacted]');
    assert.equal(result.records[0].requestHeaders.accept, 'application/json');
    assert.equal(result.records[0].responseHeaders['set-cookie'], '[redacted]');
    assert.equal('requestBody' in result.records[0], false);
    assert.equal('responseBody' in result.records[0], false);
  });
});
