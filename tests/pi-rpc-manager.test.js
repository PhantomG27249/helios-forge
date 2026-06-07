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

test('pi rpc manager restarts the pi process in the selected workspace', async () => {
  const spawns = [];
  const manager = new PiRpcManager({
    initialCwd: 'C:\\Users\\jackj\\Github\\chat-app',
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
  assert.equal(spawns[0].options.cwd, 'C:\\Users\\jackj\\Github\\chat-app');

  await manager.changeWorkspace('C:\\Users\\jackj\\Github\\Some Project');

  assert.equal(manager.cwd, 'C:\\Users\\jackj\\Github\\Some Project');
  assert.equal(spawns.length, 2);
  assert.equal(spawns[1].options.cwd, 'C:\\Users\\jackj\\Github\\Some Project');
  assert.equal(spawns[0].child.exitCode, 0);
});

