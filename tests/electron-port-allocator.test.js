import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { allocateLoopbackPort } from '../src/electron/portAllocator.js';

test('allocateLoopbackPort returns preferred port when free', async () => {
  const port = await allocateLoopbackPort(0);
  assert.ok(Number.isInteger(port));
  assert.ok(port >= 1024 && port <= 65535);
});

test('allocateLoopbackPort falls back when preferred port is busy', async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(3777, '127.0.0.1', resolve));

  try {
    const port = await allocateLoopbackPort(3777);
    assert.notEqual(port, 3777);
    assert.ok(port > 0);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});
