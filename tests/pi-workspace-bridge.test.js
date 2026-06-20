import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { setupHeliosForge } from '../scripts/setup-helios-forge.js';
import {
  buildHeliosChatContext,
  ensurePiWorkplaceBridge,
  prependHeliosChatContext,
} from '../src/harness/piWorkspaceBridge.js';

test('ensurePiWorkplaceBridge installs the Helios package when missing', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-pi-bridge-'));
  try {
    const bridge = await ensurePiWorkplaceBridge(workspaceRoot);
    assert.equal(bridge.repaired, true);
    assert.ok(bridge.repairs.includes('scaffold'));
    assert.match(bridge.manifestPath, /capabilities\.mount\.json$/);
    assert.equal(bridge.status.bundledPackage.present, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('buildHeliosChatContext includes unified bridge pack sections', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-pi-bridge-'));
  try {
    await setupHeliosForge({ workspaceRoot });
    const context = await buildHeliosChatContext(workspaceRoot);
    assert.match(context, /Unified Helios bridge context/);
    assert.match(context, /Deep Research/);
    assert.match(context, /\/deep-research/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('prependHeliosChatContext avoids duplicate injection', () => {
  const context = '[Helios Forge]\nDeep research enabled\n[/Helios Forge]';
  const message = prependHeliosChatContext('already has [Helios Forge] block', context);
  assert.equal(message, 'already has [Helios Forge] block');
});
