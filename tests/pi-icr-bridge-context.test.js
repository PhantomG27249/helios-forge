import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadIcrBridgeContext } from '../src/harness-sidecar/pi/icrBridgeContext.js';

test('loadIcrBridgeContext returns null when icr disabled', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-icr-'));
  try {
    const result = await loadIcrBridgeContext({
      workspaceRoot,
      harnessConfig: { features: { icr: { enabled: false } } },
    });
    assert.equal(result, null);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadIcrBridgeContext returns empty summary when enabled but no evidence', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-icr-'));
  try {
    const result = await loadIcrBridgeContext({
      workspaceRoot,
      harnessConfig: { icr: { enabled: true } },
    });
    assert.equal(result.familyCount, 0);
    assert.equal(result.canPromote, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
