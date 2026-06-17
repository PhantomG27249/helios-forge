import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import {
  createRuntimePlan,
  shouldAutoRegisterElectronApp,
  startServer,
  stopServer,
} from '../src/electron/main.js';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalled = false;
  child.killed = false;
  child.kill = () => {
    child.killCalled = true;
    child.killed = true;
    child.emit('close', 0);
    return true;
  };
  return child;
}

test('createRuntimePlan uses dynamic port and dev paths', async () => {
  const plan = await createRuntimePlan({
    isPackaged: false,
    allocateLoopbackPort: async () => 4222,
  });

  assert.equal(plan.port, 4222);
  assert.equal(plan.appUrl, 'http://127.0.0.1:4222/');
  assert.ok(plan.paths.serverEntry.endsWith('src\\server.js') || plan.paths.serverEntry.endsWith('src/server.js'));
});

test('startServer pipes stdout and resolves when the server reports readiness', async () => {
  const child = makeFakeChild();
  const spawnCalls = [];
  const logs = [];

  const ready = startServer({
    spawnFn: (...args) => {
      spawnCalls.push(args);
      return child;
    },
    port: '4222',
    env: {},
    log: { log: (message) => logs.push(message), error: () => {} },
    readyTimeoutMs: 1000,
    paths: {
      appRoot: process.cwd(),
      serverEntry: 'src/server.js',
    },
  });

  child.stdout.write('[Server] Listening on http://0.0.0.0:4222\n');
  const resolvedChild = await ready;

  assert.equal(resolvedChild, child);
  assert.equal(spawnCalls[0][2].stdio[1], 'pipe');
  assert.equal(spawnCalls[0][2].stdio[2], 'pipe');
  assert.equal(spawnCalls[0][2].env.PORT, '4222');
  assert.deepEqual(logs, ['[Server] Listening on http://0.0.0.0:4222']);
});

test('stopServer kills a running server process once', async () => {
  const child = makeFakeChild();

  await stopServer(child);
  await stopServer(child);

  assert.equal(child.killCalled, true);
});

test('Electron app auto-registers based on Electron runtime instead of argv shape', () => {
  assert.equal(shouldAutoRegisterElectronApp({ versions: { electron: '33.0.0' } }), true);
  assert.equal(shouldAutoRegisterElectronApp({ versions: { node: process.versions.node } }), false);
});
