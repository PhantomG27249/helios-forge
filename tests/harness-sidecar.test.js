import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createHarnessSidecar } from '../src/harness-sidecar/server.js';

async function withSidecar(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-harness-test-'));
  const sidecar = createHarnessSidecar({ workspaceRoot, port: 0 });
  await sidecar.start();

  try {
    await testFn({ sidecar, workspaceRoot });
  } finally {
    await sidecar.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function waitForEvent(events, predicate, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const existing = events.find(predicate);
    if (existing) {
      resolve(existing);
      return;
    }

    const deadline = setTimeout(() => {
      reject(new Error('Timed out waiting for sidecar event'));
    }, timeoutMs);

    events.push = new Proxy(events.push, {
      apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        const event = args[0];
        if (predicate(event)) {
          clearTimeout(deadline);
          resolve(event);
        }
        return result;
      },
    });
  });
}

test('health endpoint reports status and workspace root', async () => {
  await withSidecar(async ({ sidecar, workspaceRoot }) => {
    const response = await fetch(`${sidecar.url}/v1/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.workspaceRoot, workspaceRoot);
    assert.equal(body.version, '0.1.0');
  });
});

test('task endpoint emits deterministic MVP events and writes a trace', async () => {
  await withSidecar(async ({ sidecar, workspaceRoot }) => {
    const events = [];
    const unsubscribe = sidecar.onEvent((event) => events.push(event));

    const response = await fetch(`${sidecar.url}/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'local',
        task: 'fix the failing test',
        mode: 'mvp',
        budget: { maxToolCalls: 20, maxWallMinutes: 15 },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.match(body.taskId, /^task_/);

    const approvalEvent = await waitForEvent(
      events,
      (event) => event.taskId === body.taskId && event.type === 'approval.required',
    );

    assert.equal(approvalEvent.risk, 'medium');
    assert.equal(approvalEvent.choices.includes('approve'), true);
    assert.equal(events.some((event) => event.type === 'context_pack.created'), true);
    assert.equal(events.some((event) => event.type === 'subgoals.planned'), true);
    assert.equal(events.some((event) => event.type === 'budget.updated'), true);
    assert.equal(events.some((event) => event.type === 'collaboration.lock_acquired'), true);
    assert.equal(events.some((event) => event.type === 'task_state.updated'), true);
    assert.equal(events.some((event) => event.type === 'audit.recorded' && event.operation === 'task.create'), true);
    assert.equal(events.some((event) => event.type === 'verifier.output' && /MVP verifier passed/.test(event.stdout)), true);
    const patchEvent = events.find((event) => event.type === 'patch.proposed');
    assert.equal(Boolean(patchEvent), true);
    assert.equal(patchEvent.artifacts.length, 1);
    assert.equal(patchEvent.artifacts[0].type, 'patch_manifest');

    const artifactResponse = await fetch(`${sidecar.url}/v1/artifacts/${patchEvent.artifacts[0].artifactId}`);
    const artifactBody = await artifactResponse.json();
    assert.equal(artifactResponse.status, 200);
    assert.equal(artifactBody.artifact.artifactId, patchEvent.artifacts[0].artifactId);
    assert.equal(artifactBody.content.includes('Demonstrate patch proposal flow'), true);

    const tracePath = path.join(workspaceRoot, '.harness', 'traces', body.taskId, 'events.jsonl');
    const traceContent = await readFile(tracePath, 'utf8');
    assert.match(traceContent, /task\.started/);
    assert.match(traceContent, /approval\.required/);

    const taskResponse = await fetch(`${sidecar.url}/v1/tasks/${body.taskId}`);
    const taskDetail = await taskResponse.json();
    assert.equal(taskResponse.status, 200);
    assert.equal(taskDetail.task.taskId, body.taskId);
    assert.equal(taskDetail.state.version >= 2, true);
    assert.equal(taskDetail.audit.some((entry) => entry.operation === 'patch.propose'), true);

    unsubscribe();
  });
});

test('approval endpoint resolves a pending approval and emits an event', async () => {
  await withSidecar(async ({ sidecar }) => {
    const events = [];
    const unsubscribe = sidecar.onEvent((event) => events.push(event));

    const taskResponse = await fetch(`${sidecar.url}/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'local',
        task: 'approve a toy patch',
        mode: 'mvp',
        budget: { maxToolCalls: 20, maxWallMinutes: 15 },
      }),
    });
    const taskBody = await taskResponse.json();
    const approvalEvent = await waitForEvent(
      events,
      (event) => event.taskId === taskBody.taskId && event.type === 'approval.required',
    );

    const response = await fetch(`${sidecar.url}/v1/approvals/${approvalEvent.actionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choice: 'approve' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'resolved');
    assert.equal(body.choice, 'approve');

    const resolvedEvent = await waitForEvent(
      events,
      (event) => event.type === 'approval.resolved' && event.actionId === approvalEvent.actionId,
    );
    assert.equal(resolvedEvent.choice, 'approve');

    const taskDetailResponse = await fetch(`${sidecar.url}/v1/tasks/${taskBody.taskId}`);
    const taskDetail = await taskDetailResponse.json();
    assert.equal(taskDetail.audit.some((entry) => entry.operation === 'approval.resolve'), true);
    assert.equal(taskDetail.state.value.approvalChoice, 'approve');

    unsubscribe();
  });
});
