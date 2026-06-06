import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { HarnessManager } from '../src/harness/harnessManager.js';

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('harness manager starts, reports, restarts, and stops the sidecar process', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-harness-manager-'));
  const port = await getFreePort();
  const manager = new HarnessManager({
    workspaceRoot,
    port,
    sidecarEntry: path.resolve('src/harness-sidecar/server.js'),
  });

  try {
    assert.equal(manager.getStatus().state, 'stopped');

    await manager.start();
    const runningStatus = manager.getStatus();
    assert.equal(runningStatus.state, 'running');
    assert.equal(runningStatus.port, port);
    assert.equal(runningStatus.workspaceRoot, workspaceRoot);
    assert.match(runningStatus.url, /^http:\/\/127\.0\.0\.1:/);

    const healthResponse = await fetch(`${runningStatus.url}/v1/health`);
    const health = await healthResponse.json();
    assert.equal(health.status, 'ok');

    await manager.restart();
    assert.equal(manager.getStatus().state, 'running');
    assert.equal(manager.getStatus().restartCount, 1);

    await manager.stop();
    assert.equal(manager.getStatus().state, 'stopped');
    assert.equal(manager.getStatus().pid, null);
    assert.equal(manager.getStatus().logs.some((line) => line.includes('HarnessSidecar')), true);
  } finally {
    await manager.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
