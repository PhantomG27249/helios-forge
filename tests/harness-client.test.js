import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { HarnessClient } from '../src/harness/harnessClient.js';
import { createHarnessSidecar } from '../src/harness-sidecar/server.js';

async function withSidecarClient(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-harness-client-'));
  const sidecar = createHarnessSidecar({ workspaceRoot, port: 0 });
  await sidecar.start();
  const client = new HarnessClient({ baseUrl: sidecar.url });

  try {
    await testFn({ client });
  } finally {
    client.close();
    await sidecar.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('harness client reads sidecar health', async () => {
  await withSidecarClient(async ({ client }) => {
    const health = await client.getHealth();

    assert.equal(health.status, 'ok');
    assert.equal(health.version, '0.1.0');
  });
});

test('harness client starts tasks, reads artifacts, and resolves approvals', async () => {
  await withSidecarClient(async ({ client }) => {
    const task = await client.startTask({
      workspaceId: 'local',
      task: 'run the client test',
      mode: 'mvp',
      budget: { maxToolCalls: 10, maxWallMinutes: 5 },
    });

    assert.match(task.taskId, /^task_/);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const patchEvent = client.lastEvents.find((event) => event.type === 'patch.proposed');
    assert.equal(Boolean(patchEvent), true);
    const artifact = await client.getArtifact(patchEvent.artifacts[0].artifactId);
    assert.equal(artifact.artifact.artifactId, patchEvent.artifacts[0].artifactId);
    assert.equal(artifact.content.includes('run the client test'), true);

    const approvalEvent = client.lastEvents.find((event) => event.type === 'approval.required');
    assert.equal(Boolean(approvalEvent), true);

    const approval = await client.resolveApproval(approvalEvent.actionId, 'approve');
    assert.equal(approval.status, 'resolved');
    assert.equal(approval.choice, 'approve');
  });
});
