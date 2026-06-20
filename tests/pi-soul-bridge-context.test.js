import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadSoulBridgeContext } from '../src/harness-sidecar/pi/soulBridgeContext.js';

test('loadSoulBridgeContext creates default oversoul when missing', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-soul-'));
  try {
    const result = await loadSoulBridgeContext({ workspaceRoot });
    assert.equal(result.canPromote, false);
    assert.ok(typeof result.markdown === 'string');
    assert.ok(result.oversoulRef?.oversoulId);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
