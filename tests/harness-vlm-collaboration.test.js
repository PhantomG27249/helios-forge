import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createArtifactStore } from '../src/harness-sidecar/artifacts/artifactStore.js';
import { createVisualDiffArtifact } from '../src/harness-sidecar/vlm/visualDiff.js';
import { createVisualContextItem } from '../src/harness-sidecar/vlm/visualContextPolicy.js';
import { AuditLog } from '../src/harness-sidecar/collaboration/auditLog.js';
import { LockService } from '../src/harness-sidecar/collaboration/locks.js';
import { VersionedState } from '../src/harness-sidecar/collaboration/versionedState.js';

test('artifact store writes and reads text artifact manifests', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-artifacts-'));
  const store = createArtifactStore({ workspaceRoot });

  try {
    const artifact = await store.writeTextArtifact({
      taskId: 'task_artifact',
      type: 'patch',
      title: 'Patch proposal',
      filename: 'patch.diff',
      content: 'diff --git a/a b/a\n',
    });

    assert.match(artifact.artifactId, /^art_/);
    assert.equal(artifact.contentType, 'text/plain');
    assert.equal(await readFile(artifact.path, 'utf8'), 'diff --git a/a b/a\n');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('visual diff artifact records before after and diff paths', () => {
  const artifact = createVisualDiffArtifact({
    taskId: 'task_visual',
    beforePath: 'before.png',
    afterPath: 'after.png',
    diffPath: 'diff.png',
    summary: 'Legend fixed',
  });

  assert.equal(artifact.type, 'visual_diff');
  assert.equal(artifact.artifacts.before, 'before.png');
  assert.equal(createVisualContextItem(artifact).tokensEstimated > 0, true);
});

test('lock service grants, rejects, and releases resource locks', () => {
  const locks = new LockService();
  const first = locks.acquire({ resource: 'src/server.js', ownerId: 'agent_a', taskId: 'task_lock' });
  const second = locks.acquire({ resource: 'src/server.js', ownerId: 'agent_b', taskId: 'task_lock' });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(locks.release(first.lockId, 'agent_a').released, true);
  assert.equal(locks.acquire({ resource: 'src/server.js', ownerId: 'agent_b', taskId: 'task_lock' }).acquired, true);
});

test('versioned state rejects stale updates', () => {
  const state = new VersionedState({ initialValue: { status: 'new' } });
  const first = state.update({ expectedVersion: 0, patch: { status: 'running' }, updatedBy: 'agent_a' });
  const stale = state.update({ expectedVersion: 0, patch: { status: 'done' }, updatedBy: 'agent_b' });

  assert.equal(first.applied, true);
  assert.equal(stale.applied, false);
  assert.equal(stale.reason, 'version_conflict');
});

test('audit log records actor target operation and reason', () => {
  const log = new AuditLog();
  log.record({
    actor: 'human:jack',
    target: 'project_memory',
    operation: 'approve_memory_write',
    reason: 'validated by task',
  });

  const entries = log.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].actor, 'human:jack');
  assert.match(entries[0].auditId, /^audit_/);
});
