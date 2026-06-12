import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildOperatorDashboardSnapshot,
  createOperatorDashboardStore,
} from '../src/harness-sidecar/meta/operatorDashboardStore.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-operator-dashboard-'));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('operator dashboard snapshot normalizes evidence lanes and strips promotion authority', () => {
  const snapshot = buildOperatorDashboardSnapshot({
    frontier: { status: 'improving', canPromote: true },
    governance: { pendingApprovals: 2, apply: true },
    memory: null,
    visual: [{ suiteId: 'visual-smoke', passed: true }],
    trust: { authority: 'admin' },
    swarm: { active: 3 },
    rho: { trend: 'stable' },
    router: { recommendedModel: 'qwen' },
    now: () => new Date('2026-06-12T12:34:56.000Z'),
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.snapshotId, 'operator-2026-06-12T12-34-56-000Z');
  assert.equal(snapshot.createdAt, '2026-06-12T12:34:56.000Z');
  assert.equal(snapshot.evidenceOnly, true);
  assert.equal(snapshot.canPromote, false);
  assert.equal(snapshot.frontier.canPromote, false);
  assert.equal(snapshot.governance.apply, false);
  assert.equal(snapshot.memory.status, 'unavailable');
  assert.deepEqual(snapshot.visual.items, [{ suiteId: 'visual-smoke', passed: true }]);
  assert.equal(snapshot.trust.authority, 'evidence_only');
  assert.equal(typeof snapshot.promote, 'undefined');
  assert.equal(typeof snapshot.apply, 'undefined');
});

test('operator dashboard snapshot recursively quarantines model-visible secrets and unsafe paths', () => {
  const snapshot = buildOperatorDashboardSnapshot({
    memory: {
      summary: 'extracted secret from C:\\Users\\jackj\\secret.txt',
      nested: {
        note: 'operator saw token=sk-should-not-leak',
        external: true,
        verified: true,
        artifactPath: '../outside/evidence.json',
      },
    },
  });

  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('sk-should-not-leak'), false);
  assert.equal(serialized.includes('secret.txt'), false);
  assert.equal(snapshot.memory.nested.verified, false);
  assert.equal(snapshot.memory.nested.artifactPath, '[redacted:path]');
  assert.equal(snapshot.quarantine.quarantined, true);
  assert.ok(snapshot.quarantine.reasons.includes('secret_like_value'));
  assert.ok(snapshot.quarantine.reasons.includes('unsafe_path_value'));
  assert.ok(snapshot.quarantine.reasons.includes('external_verification_escalation'));
});

test('operator dashboard store persists snapshots under .harness dashboards operator', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const store = createOperatorDashboardStore({ workspaceRoot });
    const snapshot = buildOperatorDashboardSnapshot({
      frontier: { status: 'baseline' },
      now: () => new Date('2026-06-12T00:00:00.000Z'),
    });

    const saved = await store.saveSnapshot(snapshot);
    const expectedPath = path.join(
      workspaceRoot,
      '.harness',
      'dashboards',
      'operator',
      'operator-2026-06-12T00-00-00-000Z.json',
    );

    assert.equal(saved.filePath, expectedPath);
    assert.equal(saved.snapshot.snapshotId, 'operator-2026-06-12T00-00-00-000Z');
    assert.equal(JSON.parse(await readFile(expectedPath, 'utf8')).evidenceOnly, true);
    assert.equal(path.relative(workspaceRoot, saved.filePath).startsWith(`.harness${path.sep}dashboards${path.sep}operator`), true);
  });
});

test('operator dashboard store loads snapshots and lists ids deterministically', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const store = createOperatorDashboardStore({ workspaceRoot });
    await store.saveSnapshot(buildOperatorDashboardSnapshot({
      now: () => new Date('2026-06-12T00:00:02.000Z'),
      router: { recommendedModel: 'late' },
    }));
    await store.saveSnapshot(buildOperatorDashboardSnapshot({
      now: () => new Date('2026-06-12T00:00:01.000Z'),
      router: { recommendedModel: 'early' },
    }));

    assert.deepEqual(await store.listSnapshotIds(), [
      'operator-2026-06-12T00-00-01-000Z',
      'operator-2026-06-12T00-00-02-000Z',
    ]);
    assert.equal((await store.loadSnapshot('operator-2026-06-12T00-00-01-000Z')).router.recommendedModel, 'early');
  });
});

test('operator dashboard store rejects traversal, absolute, and symlink escape ids', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const calls = [];
    const fsImpl = {
      async lstat(target) {
        calls.push(['lstat', target]);
        return { isSymbolicLink: () => path.basename(target) === 'operator' };
      },
      async mkdir(target) {
        calls.push(['mkdir', target]);
      },
      async realpath(target) {
        calls.push(['realpath', target]);
        if (path.basename(target) === 'operator') {
          return path.join(tmpdir(), 'outside-operator-dashboard');
        }
        return path.resolve(target);
      },
      async writeFile(target) {
        calls.push(['writeFile', target]);
      },
      async readFile() {
        throw new Error('not used');
      },
      async readdir() {
        return [];
      },
    };
    const store = createOperatorDashboardStore({ workspaceRoot, fsImpl });
    const snapshot = buildOperatorDashboardSnapshot({
      now: () => new Date('2026-06-12T00:00:00.000Z'),
    });

    await assert.rejects(
      () => store.saveSnapshot({ ...snapshot, snapshotId: '../escape' }),
      /unsafe operator dashboard snapshot id/i,
    );
    await assert.rejects(
      () => store.loadSnapshot(path.join(workspaceRoot, '.harness', 'dashboards', 'operator', 'x')),
      /unsafe operator dashboard snapshot id/i,
    );
    await assert.rejects(
      () => store.saveSnapshot(snapshot),
      /symlink|junction|escapes workspace/i,
    );
    assert.equal(calls.some(([kind]) => kind === 'writeFile'), false);
  });
});
