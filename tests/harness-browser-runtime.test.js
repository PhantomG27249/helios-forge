import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBrowserSessionRuntime } from '../src/harness-sidecar/browser/browserSessionRuntime.js';
import { createPlaywrightBrowserAdapter } from '../src/harness-sidecar/browser/playwrightAdapter.js';

function createFakeAdapter(calls = []) {
  return {
    async createSession(input) {
      calls.push({ method: 'createSession', input });
      return {
        status: 'ready',
        adapterSessionId: `adapter_${input.sessionId}`,
        viewport: input.viewport,
      };
    },
    async navigate(session, input) {
      calls.push({ method: 'navigate', session, input });
      return { status: 'navigated', url: input.url, title: 'Helios' };
    },
    async screenshot(session, input) {
      calls.push({ method: 'screenshot', session, input });
      return { status: 'captured', path: input.outputPath, width: 800, height: 600 };
    },
    async consoleRead(session) {
      calls.push({ method: 'consoleRead', session });
      return [
        {
          type: 'error',
          text: 'failed with Authorization: Bearer secret-token and token=abc123',
          url: 'http://127.0.0.1:3000/app?token=abc123#frag',
          headers: { authorization: 'Bearer secret-token' },
        },
      ];
    },
    async networkSummary(session) {
      calls.push({ method: 'networkSummary', session });
      return [
        {
          method: 'GET',
          url: 'http://127.0.0.1:3000/api?api_key=secret',
          status: 401,
          requestHeaders: { authorization: 'Bearer secret-token', cookie: 'sid=secret' },
          responseHeaders: { 'set-cookie': 'sid=secret', 'content-type': 'application/json' },
          requestBody: 'secret request body',
          responseBody: 'secret response body',
        },
      ];
    },
    async domSnapshot(session) {
      calls.push({ method: 'domSnapshot', session });
      return { status: 'captured', text: 'Main content', roles: [{ role: 'main', name: 'App' }] };
    },
    async closeSession(session) {
      calls.push({ method: 'closeSession', session });
      return { status: 'closed' };
    },
  };
}

test('browser session runtime reports unavailable when no adapter is injected', async () => {
  const runtime = createBrowserSessionRuntime({ workspaceRoot: process.cwd() });

  const result = await runtime.createSession({ taskId: 'task_no_adapter' });

  assert.deepEqual(result, {
    status: 'unavailable',
    reason: 'browser_runtime_required',
  });
});

test('browser session runtime drives fake adapter, sanitizes output, and emits events', async () => {
  const calls = [];
  const events = [];
  const runtime = createBrowserSessionRuntime({
    workspaceRoot: process.cwd(),
    adapter: createFakeAdapter(calls),
    emitEvent: (event) => events.push(event),
    policy: {
      allowedOrigins: ['http://127.0.0.1:3000'],
    },
  });

  const session = await runtime.createSession({
    taskId: 'task_runtime',
    viewport: { width: 800, height: 600 },
  });
  assert.equal(session.status, 'ready');
  assert.equal(session.sessionId, 'browser_task_runtime_1');
  assert.equal(session.adapterSessionId, undefined);

  const navigation = await runtime.navigate({
    sessionId: session.sessionId,
    url: 'http://127.0.0.1:3000/app?token=abc123#frag',
  });
  assert.equal(navigation.status, 'navigated');
  assert.equal(navigation.url, 'http://127.0.0.1:3000/app');

  const screenshot = await runtime.screenshot({
    sessionId: session.sessionId,
    outputPath: 'C:/tmp/browser.png',
  });
  assert.deepEqual(screenshot, {
    status: 'captured',
    sessionId: session.sessionId,
    path: 'C:/tmp/browser.png',
    width: 800,
    height: 600,
  });

  const consoleResult = await runtime.consoleRead({ sessionId: session.sessionId });
  assert.equal(consoleResult.status, 'completed');
  assert.equal(consoleResult.entries.length, 1);
  assert.equal(JSON.stringify(consoleResult).includes('secret-token'), false);
  assert.equal(JSON.stringify(consoleResult).includes('abc123'), false);
  assert.equal(JSON.stringify(consoleResult).includes('authorization'), false);
  assert.equal(consoleResult.entries[0].url, 'http://127.0.0.1:3000/app');

  const network = await runtime.networkSummary({ sessionId: session.sessionId });
  assert.equal(network.status, 'completed');
  assert.equal(network.records.length, 1);
  assert.equal(network.records[0].url, 'http://127.0.0.1:3000/api');
  assert.deepEqual(network.records[0].requestHeaders, { authorization: '[redacted]', cookie: '[redacted]' });
  assert.deepEqual(network.records[0].responseHeaders, {
    'set-cookie': '[redacted]',
    'content-type': 'application/json',
  });
  assert.equal(JSON.stringify(network).includes('secret request body'), false);
  assert.equal(JSON.stringify(network).includes('secret response body'), false);

  const dom = await runtime.domSnapshot({ sessionId: session.sessionId });
  assert.deepEqual(dom, {
    status: 'captured',
    sessionId: session.sessionId,
    text: 'Main content',
    roles: [{ role: 'main', name: 'App' }],
  });

  const close = await runtime.closeSession({ sessionId: session.sessionId });
  assert.deepEqual(close, { status: 'closed', sessionId: session.sessionId });

  assert.deepEqual(calls.map((call) => call.method), [
    'createSession',
    'navigate',
    'screenshot',
    'consoleRead',
    'networkSummary',
    'domSnapshot',
    'closeSession',
  ]);
  assert.deepEqual(events.map((event) => event.type), [
    'browser.session_started',
    'browser.navigation',
    'browser.screenshot_captured',
    'browser.console_read',
    'browser.network_summary',
    'browser.session_closed',
  ]);
});

test('browser session runtime enforces URL policy before adapter navigation', async () => {
  const calls = [];
  const runtime = createBrowserSessionRuntime({
    workspaceRoot: process.cwd(),
    adapter: createFakeAdapter(calls),
    policy: {
      allowedOrigins: ['http://127.0.0.1:3000'],
    },
  });

  const session = await runtime.createSession({ taskId: 'task_policy' });
  const result = await runtime.navigate({
    sessionId: session.sessionId,
    url: 'https://example.com/private',
  });

  assert.equal(result.status, 'denied');
  assert.equal(result.reason, 'browser_url_policy_denied');
  assert.equal(calls.some((call) => call.method === 'navigate'), false);
});

test('browser session runtime returns structured not_found when closing a missing session', async () => {
  const runtime = createBrowserSessionRuntime({
    workspaceRoot: process.cwd(),
    adapter: createFakeAdapter(),
  });

  const result = await runtime.closeSession({ sessionId: 'browser_missing_1' });

  assert.deepEqual(result, {
    status: 'not_found',
    reason: 'browser_session_not_found',
    sessionId: 'browser_missing_1',
  });
});

test('playwright adapter reports unavailable without a supplied or installed runtime', async () => {
  const adapter = await createPlaywrightBrowserAdapter({ playwright: null });

  assert.deepEqual(adapter, {
    status: 'unavailable',
    reason: 'playwright_runtime_required',
  });
});

test('playwright adapter uses sandbox-safe launch and context options with injected module', async () => {
  const launchCalls = [];
  const contextCalls = [];
  const routeCalls = [];
  const fakePage = {
    async goto() {},
    async screenshot() {
      return Buffer.from('png');
    },
    async title() {
      return 'Preview';
    },
    async close() {},
  };
  const fakeBrowser = {
    async newContext(options) {
      contextCalls.push(options);
      return {
        async route(pattern, handler) {
          routeCalls.push({ pattern, handlerType: typeof handler });
        },
        async newPage() {
          return fakePage;
        },
        async close() {},
      };
    },
    async close() {},
  };
  const fakePlaywright = {
    chromium: {
      async launch(options) {
        launchCalls.push(options);
        return fakeBrowser;
      },
    },
  };

  const adapter = await createPlaywrightBrowserAdapter({ playwright: fakePlaywright });
  const session = await adapter.createSession({
    sessionId: 'browser_task_1',
    viewport: { width: 900, height: 700 },
  });

  assert.equal(session.status, 'ready');
  assert.equal(launchCalls.length, 1);
  assert.equal(launchCalls[0].headless, true);
  assert.equal(launchCalls[0].userDataDir, undefined);
  assert.equal(contextCalls.length, 1);
  assert.equal(contextCalls[0].serviceWorkers, 'block');
  assert.equal(contextCalls[0].acceptDownloads, false);
  assert.deepEqual(contextCalls[0].viewport, { width: 900, height: 700 });
  assert.equal(routeCalls.length, 1);
  assert.equal(routeCalls[0].pattern, '**/*');

  await adapter.closeSession(session);
});

test('playwright adapter aborts routed external requests under default localhost policy', async () => {
  let routeHandler;
  const fakePage = {
    async goto() {},
  };
  const fakePlaywright = {
    chromium: {
      async launch() {
        return {
          async newContext() {
            return {
              async route(pattern, handler) {
                routeHandler = handler;
              },
              async newPage() {
                return fakePage;
              },
            };
          },
        };
      },
    },
  };
  const aborts = [];
  const continues = [];
  const fakeRoute = {
    request() {
      return {
        url() {
          return 'https://example.com/script.js';
        },
      };
    },
    async abort(reason) {
      aborts.push(reason);
    },
    async continue() {
      continues.push(true);
    },
  };

  const adapter = await createPlaywrightBrowserAdapter({ playwright: fakePlaywright });
  await adapter.createSession({ sessionId: 'browser_policy_route_external' });
  await routeHandler(fakeRoute);

  assert.deepEqual(aborts, ['blockedbyclient']);
  assert.deepEqual(continues, []);
});

test('playwright adapter continues routed loopback requests under default localhost policy', async () => {
  let routeHandler;
  const fakePage = {
    async goto() {},
  };
  const fakePlaywright = {
    chromium: {
      async launch() {
        return {
          async newContext() {
            return {
              async route(pattern, handler) {
                routeHandler = handler;
              },
              async newPage() {
                return fakePage;
              },
            };
          },
        };
      },
    },
  };
  const aborts = [];
  const continues = [];
  const fakeRoute = {
    request() {
      return {
        url() {
          return 'http://127.0.0.1/app';
        },
      };
    },
    async abort(reason) {
      aborts.push(reason);
    },
    async continue() {
      continues.push(true);
    },
  };

  const adapter = await createPlaywrightBrowserAdapter({ playwright: fakePlaywright });
  await adapter.createSession({ sessionId: 'browser_policy_route_loopback' });
  await routeHandler(fakeRoute);

  assert.deepEqual(aborts, []);
  assert.deepEqual(continues, [true]);
});

test('playwright adapter rejects navigation when final URL violates default localhost policy', async () => {
  const fakePage = {
    async goto() {
      return 'https://example.com/redirected';
    },
    async title() {
      return 'External';
    },
  };
  const fakePlaywright = {
    chromium: {
      async launch() {
        return {
          async newContext() {
            return {
              async route() {},
              async newPage() {
                return fakePage;
              },
            };
          },
        };
      },
    },
  };

  const adapter = await createPlaywrightBrowserAdapter({ playwright: fakePlaywright });
  const session = await adapter.createSession({ sessionId: 'browser_policy_redirect' });

  await assert.rejects(
    () => adapter.navigate(session, { url: 'http://127.0.0.1/app' }),
    (error) => {
      assert.equal(error.status, 'denied');
      assert.equal(error.reason, 'browser_url_policy_denied');
      assert.equal(error.url, 'https://example.com/redirected');
      return true;
    },
  );
});
