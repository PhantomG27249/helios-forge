import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildPiBridgeHealthFromTelemetry,
  recordManifestConsumed,
} from '../src/harness-sidecar/pi/piBridgeTelemetry.js';

test('recordManifestConsumed appends telemetry and health reflects consumption', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-telemetry-'));
  try {
    await recordManifestConsumed({ workspaceRoot, manifestId: 'abc123', now: () => new Date('2026-06-20T12:00:00Z') });
    const health = await buildPiBridgeHealthFromTelemetry({
      workspaceRoot,
      now: () => new Date('2026-06-20T12:01:00Z'),
    });
    assert.equal(health.manifestConsumedByPi, true);
    assert.equal(health.recentEventCount, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
