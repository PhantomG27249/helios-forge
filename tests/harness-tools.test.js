import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runShellCommand } from '../src/harness-sidecar/tools/shellBroker.js';
import { runVerifiers } from '../src/harness-sidecar/tools/verifierRunner.js';

const nodeCommand = `"${process.execPath}"`;

test('shell broker captures stdout, stderr, exit code, and duration', async () => {
  const result = await runShellCommand({
    command: `${nodeCommand} -e "console.log('ok'); console.error('warn')"`,
    cwd: process.cwd(),
    timeoutMs: 2000,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /ok/);
  assert.match(result.stderr, /warn/);
  assert.equal(typeof result.durationMs, 'number');
});

test('shell broker marks commands that exceed timeout', async () => {
  const result = await runShellCommand({
    command: `${nodeCommand} -e "setTimeout(() => {}, 2000)"`,
    cwd: process.cwd(),
    timeoutMs: 100,
  });

  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test('verifier runner emits start, output, and finish events', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-verifier-test-'));
  const events = [];

  try {
    const results = await runVerifiers({
      workspaceRoot,
      taskId: 'task_test',
      verifiers: [
        {
          name: 'node-ok',
          command: `${nodeCommand} -e "console.log('verified')"`,
          timeoutMs: 2000,
        },
      ],
      emitEvent: (event) => events.push(event),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'node-ok');
    assert.equal(results[0].passed, true);
    assert.equal(events.some((event) => event.type === 'verifier.started'), true);
    assert.equal(events.some((event) => event.type === 'verifier.output' && /verified/.test(event.stdout)), true);
    assert.equal(events.some((event) => event.type === 'verifier.finished' && event.result === 'passed'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
