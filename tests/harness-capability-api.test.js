import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { HarnessClient } from '../src/harness/harnessClient.js';
import { createHarnessSidecar } from '../src/harness-sidecar/server.js';

async function withSidecarClient(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-harness-capability-api-'));
  const sidecar = createHarnessSidecar({ workspaceRoot, port: 0 });
  await sidecar.start();
  const client = new HarnessClient({ baseUrl: sidecar.url });

  try {
    await testFn({ client, sidecar, workspaceRoot });
  } finally {
    client.close();
    await sidecar.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function waitForClientEvent(client, predicate, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const existing = client.lastEvents.find(predicate);
    if (existing) {
      resolve(existing);
      return;
    }

    const deadline = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for harness client event'));
    }, timeoutMs);

    const unsubscribe = client.onEvent((event) => {
      if (predicate(event)) {
        clearTimeout(deadline);
        unsubscribe();
        resolve(event);
      }
    });
  });
}

test('harness capability API lists, saves, deletes, and mounts records', async () => {
  await withSidecarClient(async ({ client, workspaceRoot }) => {
    const skillDir = path.join(workspaceRoot, 'skills', 'local-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Local Skill\n');

    const initial = await client.listCapabilities({ workspaceRoot });
    assert.deepEqual(initial.capabilities, []);

    const saved = await client.saveCapability({
      workspaceRoot,
      record: {
        type: 'skill',
        name: 'Local Skill',
        enabled: true,
        path: skillDir,
        env: { API_KEY: 'secret-value' },
        profiles: ['default'],
      },
    });
    assert.equal(saved.record.type, 'skill');
    assert.equal(saved.record.enabled, true);
    assert.match(saved.record.id, /^cap_/);

    const listed = await client.listCapabilities({ workspaceRoot });
    assert.equal(listed.capabilities.length, 1);
    assert.equal(listed.capabilities[0].name, 'Local Skill');
    assert.equal(listed.capabilities[0].env.API_KEY, '[redacted]');

    const mounted = await client.mountCapabilities({ workspaceRoot, profileId: 'default' });
    assert.equal(mounted.manifest.profileId, 'default');
    assert.equal(mounted.manifest.enabledCounts.skill, 1);
    assert.equal(mounted.manifest.capabilities.length, 1);
    assert.equal(mounted.manifestPath, path.join(workspaceRoot, '.harness', 'runtime', 'capabilities.mount.json'));

    const manifestContent = JSON.parse(await readFile(mounted.manifestPath, 'utf8'));
    assert.equal((manifestContent.enabledCounts || manifestContent.counts).skill, 1);
    assert.equal(JSON.stringify(manifestContent).includes('secret-value'), false);

    const deleted = await client.deleteCapability({ workspaceRoot, capabilityId: saved.record.id });
    assert.equal(deleted.deleted, true);

    const afterDelete = await client.listCapabilities({ workspaceRoot });
    assert.deepEqual(afterDelete.capabilities, []);
  });
});

test('starting a harness task mounts enabled workspace capabilities and emits runtime metadata', async () => {
  await withSidecarClient(async ({ client, workspaceRoot }) => {
    const extensionDir = path.join(workspaceRoot, 'pi-extensions', 'local-extension');
    await mkdir(extensionDir, { recursive: true });
    await writeFile(path.join(extensionDir, 'extension.json'), '{}\n');

    await client.saveCapability({
      workspaceRoot,
      record: {
        type: 'pi_extension',
        name: 'Local Extension',
        enabled: true,
        path: extensionDir,
        profiles: ['default'],
      },
    });

    const task = await client.startTask({
      workspaceId: 'local',
      task: 'mount capabilities for this task',
      mode: 'mvp',
      source: 'capability_api_test',
      profileId: 'default',
    });

    const mountedEvent = await waitForClientEvent(
      client,
      (event) => event.taskId === task.taskId && event.type === 'capabilities.runtime_mounted',
    );

    assert.equal(mountedEvent.profileId, 'default');
    assert.equal(mountedEvent.enabledCounts.pi_extension, 1);
    assert.equal(mountedEvent.manifestPath, path.join(workspaceRoot, '.harness', 'runtime', 'capabilities.mount.json'));
    assert.equal(mountedEvent.manifestPath.includes(`${path.sep}.pi${path.sep}`), false);

    const manifestContent = JSON.parse(await readFile(mountedEvent.manifestPath, 'utf8'));
    assert.equal(manifestContent.profileId, 'default');
    assert.equal((manifestContent.enabledCounts || manifestContent.counts).pi_extension, 1);
  });
});
