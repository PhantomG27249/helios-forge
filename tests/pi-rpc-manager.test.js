import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { PiRpcManager } from '../src/pi/piRpcManager.js';

function createFakePiProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.stdin = {
    write(line) {
      const request = JSON.parse(line);
      if (request.type === 'get_state') {
        queueMicrotask(() => {
          child.stdout.emit('data', `${JSON.stringify({
            type: 'response',
            id: request.id,
            success: true,
            data: { model: { name: 'fake-pi' } },
          })}\n`);
        });
      }
    },
  };
  child.kill = () => {
    child.exitCode = 0;
    queueMicrotask(() => child.emit('close', 0));
  };
  return child;
}

function createSilentPiProcess(writes = []) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.stdin = {
    write(line) {
      const request = JSON.parse(line);
      writes.push(request);
      if (request.type === 'get_state') {
        queueMicrotask(() => {
          child.stdout.emit('data', `${JSON.stringify({
            type: 'response',
            id: request.id,
            success: true,
            data: { model: { name: 'fake-pi' } },
          })}\n`);
        });
      }
    },
  };
  child.kill = () => {
    child.exitCode = 0;
    queueMicrotask(() => child.emit('close', 0));
  };
  return child;
}

test('pi rpc manager restarts the pi process in the selected workspace', async () => {
  const spawns = [];
  const manager = new PiRpcManager({
    initialCwd: 'C:\\Users\\jackj\\Github\\helios-forge',
    readyDelayMs: 0,
    resolvePiCommandImpl: () => ({ command: 'pi', args: [] }),
    spawnImpl: (command, args, options) => {
      const child = createFakePiProcess();
      spawns.push({ command, args, options, child });
      return child;
    },
  });

  await manager.start();
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].options.cwd, 'C:\\Users\\jackj\\Github\\helios-forge');

  await manager.changeWorkspace('C:\\Users\\jackj\\Github\\Some Project');

  assert.equal(manager.cwd, 'C:\\Users\\jackj\\Github\\Some Project');
  assert.equal(spawns.length, 2);
  assert.equal(spawns[1].options.cwd, 'C:\\Users\\jackj\\Github\\Some Project');
  assert.equal(spawns[0].child.exitCode, 0);
});

test('pi rpc manager scopes capability manifest env to spawned pi process', async () => {
  const spawns = [];
  const manager = new PiRpcManager({
    initialCwd: 'C:\\Users\\jackj\\Github\\helios-forge',
    readyDelayMs: 0,
    resolvePiCommandImpl: () => ({ command: 'pi', args: [] }),
    spawnImpl: (command, args, options) => {
      const child = createFakePiProcess();
      spawns.push({ command, args, options, child });
      return child;
    },
  });

  manager.setCapabilitiesManifest('C:\\Users\\jackj\\Github\\helios-forge\\.harness\\runtime\\capabilities.mount.json');
  await manager.start();

  assert.equal(
    spawns[0].options.env.HELIOS_CAPABILITIES_MANIFEST,
    'C:\\Users\\jackj\\Github\\helios-forge\\.harness\\runtime\\capabilities.mount.json',
  );
  assert.equal(spawns[0].options.env.FORCE_COLOR, '1');

  manager.setCapabilitiesManifest(null);
  await manager.changeWorkspace('C:\\Users\\jackj\\Github\\Another Project');

  assert.equal(spawns.length, 2);
  assert.equal('HELIOS_CAPABILITIES_MANIFEST' in spawns[1].options.env, false);
});

test('pi rpc manager normalizes structured prompt images before writing to pi stdin', async () => {
  const writes = [];
  const manager = new PiRpcManager({
    initialCwd: 'C:\\Users\\jackj\\Github\\helios-forge',
    readyDelayMs: 0,
    commandTimeoutMs: 50,
    resolvePiCommandImpl: () => ({ command: 'pi', args: [] }),
    spawnImpl: () => createSilentPiProcess(writes),
  });

  await manager.start();
  await assert.rejects(
    manager.sendCommand({
      type: 'prompt',
      message: 'describe this',
      images: [{ mimeType: 'image/png', data: 'abc123' }],
    }),
    /Timeout/,
  );

  const promptWrite = writes.find((write) => write.type === 'prompt');
  assert.equal(promptWrite.images.length, 1);
  assert.deepEqual(promptWrite.images[0], {
    type: 'image',
    mimeType: 'image/png',
    data: 'abc123',
  });

  await manager.stopForRestart();
});

test('pi rpc manager logs command lifecycle with safe metadata and pending timeout details', async () => {
  const logs = [];
  const writes = [];
  const manager = new PiRpcManager({
    initialCwd: 'C:\\Users\\jackj\\Github\\helios-forge',
    readyDelayMs: 1000,
    commandTimeoutMs: 10,
    logger: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    resolvePiCommandImpl: () => ({ command: 'pi', args: [] }),
    spawnImpl: () => createSilentPiProcess(writes),
  });

  await manager.start();

  await assert.rejects(
    manager.sendCommand({ type: 'prompt', message: 'hello', images: ['data:image/png;base64,secret'] }),
    /Timeout/,
  );

  const promptWrites = writes.filter((write) => write.type === 'prompt');
  assert.equal(promptWrites.length, 1);
  assert.equal(promptWrites[0].message, 'hello');
  assert.equal(promptWrites[0].images.length, 1);

  assert.ok(logs.some((entry) => entry.join(' ').includes('[PiRPC] command.start')));
  assert.ok(logs.some((entry) => entry.join(' ').includes('"type":"prompt"')));
  assert.ok(logs.some((entry) => entry.join(' ').includes('"imageCount":1')));
  assert.ok(logs.some((entry) => entry.join(' ').includes('[PiRPC] command.timeout')));
  assert.ok(logs.some((entry) => entry.join(' ').includes('"pendingCount":0')));
  assert.equal(logs.some((entry) => entry.join(' ').includes('data:image/png')), false);

  await manager.stopForRestart();
});
