import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createArtifactStore } from '../src/harness-sidecar/artifacts/artifactStore.js';
import { createVisualDiffArtifact } from '../src/harness-sidecar/vlm/visualDiff.js';
import { createVisualContextItem } from '../src/harness-sidecar/vlm/visualContextPolicy.js';
import { AuditLog } from '../src/harness-sidecar/collaboration/auditLog.js';
import { AnnotationStore } from '../src/harness-sidecar/collaboration/annotations.js';
import { resolveVersionConflict } from '../src/harness-sidecar/collaboration/conflictResolver.js';
import { LockService } from '../src/harness-sidecar/collaboration/locks.js';
import { getRolePolicy } from '../src/harness-sidecar/collaboration/roles.js';
import { TaskClaimStore } from '../src/harness-sidecar/collaboration/taskClaims.js';
import { VersionedState } from '../src/harness-sidecar/collaboration/versionedState.js';
import { WorkspaceLeaseService } from '../src/harness-sidecar/collaboration/workspaceLeases.js';

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

test('artifact store reads visual artifact paths as preview data URLs', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-artifacts-'));
  const store = createArtifactStore({ workspaceRoot });

  try {
    const imagePath = path.join(workspaceRoot, 'preview.png');
    await writeFile(
      imagePath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
    );
    const result = await store.readArtifact({
      artifactId: 'screenshot_test',
      type: 'screenshot',
      summary: 'Preview screenshot',
      artifacts: { image: imagePath },
    });

    assert.equal(result.contentType, 'image/png');
    assert.match(result.dataUrl, /^data:image\/png;base64,/);
    assert.equal(result.content, 'Preview screenshot');
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

test('workspace lease service grants exclusive leases per workspace', () => {
  const leases = new WorkspaceLeaseService();
  const first = leases.acquire({ workspaceRoot: 'C:/repo', ownerId: 'agent_a', purpose: 'attempt' });
  const second = leases.acquire({ workspaceRoot: 'C:/repo', ownerId: 'agent_b', purpose: 'attempt' });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(leases.release(first.leaseId, 'agent_a').released, true);
});

test('task claims assign roles and reject conflicting active claims', () => {
  const claims = new TaskClaimStore();
  const first = claims.claim({ taskId: 'task_1', actorId: 'agent_a', role: 'implementer' });
  const second = claims.claim({ taskId: 'task_1', actorId: 'agent_b', role: 'implementer' });

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(claims.release(first.claimId, 'agent_a').released, true);
});

test('role policies describe allowed collaboration actions', () => {
  const reviewer = getRolePolicy('reviewer');

  assert.equal(reviewer.canApprove, true);
  assert.equal(reviewer.allowedActions.includes('comment'), true);
});

test('annotations attach review comments to task targets', () => {
  const annotations = new AnnotationStore();
  const entry = annotations.add({
    taskId: 'task_1',
    target: 'patch:one',
    author: 'reviewer',
    body: 'Needs another verifier.',
  });

  assert.match(entry.annotationId, /^ann_/);
  assert.equal(annotations.forTask('task_1').length, 1);
});

test('conflict resolver reports stale version conflicts and mergeable patches', () => {
  const stale = resolveVersionConflict({
    currentVersion: 3,
    attemptedVersion: 2,
    currentValue: { status: 'running' },
    attemptedPatch: { status: 'approved' },
  });
  const mergeable = resolveVersionConflict({
    currentVersion: 3,
    attemptedVersion: 3,
    currentValue: { status: 'running' },
    attemptedPatch: { owner: 'agent_a' },
  });

  assert.equal(stale.resolution, 'manual_review');
  assert.equal(mergeable.resolution, 'merge');
  assert.equal(mergeable.value.owner, 'agent_a');
});
