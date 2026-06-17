import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createProductionQueueProvider } from '../src/harness-sidecar/interop/productionQueueProvider.js';

test('production queue provider exposes durable adapter interface when gate enabled', () => {
  const calls = [];
  let stored = { outbox: [] };
  const provider = createProductionQueueProvider({
    featureFlags: {
      productionCapabilities: {
        productionA2aQueues: {
          enabled: true,
          mode: 'advisory',
          authority: 'evidence_only',
        },
      },
    },
    adapter: {
      load: () => stored,
      save: (state) => {
        calls.push(state);
        stored = state;
      },
    },
  });

  const queued = provider.enqueue('outbox', {
    messageId: 'msg-prod-1',
    taskId: 'task-prod-1',
    payload: { prompt: 'queue without token=ghp_never_visible' },
  });

  assert.equal(queued.messageId, 'msg-prod-1');
  assert.equal(provider.list('outbox').length, 1);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(calls[0]).includes('ghp_never_visible'), false);
  assert.equal(provider.describe().type, 'production_queue_provider');
  assert.equal(provider.describe().enabled, true);
  assert.equal(provider.describe().authority, 'evidence_only');
});

test('production queue provider rejects enqueue when production gate is disabled', () => {
  const provider = createProductionQueueProvider({
    featureFlags: {
      productionCapabilities: {
        productionA2aQueues: {
          enabled: false,
          mode: 'offline',
          authority: 'evidence_only',
        },
      },
    },
    adapter: {
      load: () => ({ outbox: [] }),
      save: () => {},
    },
  });

  assert.throws(
    () => provider.enqueue('outbox', { messageId: 'msg-blocked', taskId: 'task-blocked' }),
    /production_a2a_queues_disabled/,
  );
  assert.equal(provider.describe().enabled, false);
});

test('production queue provider hydrates JSON durable store with workspace root constraints', () => {
  const root = mkdtempSync(join(tmpdir(), 'helios-prod-queue-'));
  const storePath = join(root, 'queues', 'production.json');
  try {
    const provider = createProductionQueueProvider({
      workspaceRoot: root,
      featureFlags: {
        productionCapabilities: {
          productionA2aQueues: { enabled: true, mode: 'advisory', authority: 'evidence_only' },
        },
      },
      durableStore: { path: storePath, root },
    });

    provider.enqueue('outbox', {
      messageId: 'msg-json',
      taskId: 'task-json',
      apiKey: 'sk-never-visible',
    });

    assert.equal(existsSync(storePath), true);
    assert.equal(readFileSync(storePath, 'utf8').includes('sk-never-visible'), false);

    const restored = createProductionQueueProvider({
      workspaceRoot: root,
      featureFlags: {
        productionCapabilities: {
          productionA2aQueues: { enabled: true, mode: 'advisory', authority: 'evidence_only' },
        },
      },
      durableStore: { path: storePath, root },
    });

    assert.deepEqual(restored.list('outbox').map((record) => record.messageId), ['msg-json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
