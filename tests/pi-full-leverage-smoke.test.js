import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { setupHeliosForge } from '../scripts/setup-helios-forge.js';
import { buildPiBridgeContextPack, renderPiBridgeContextMarkdown } from '../src/harness-sidecar/pi/piBridgeContextPack.js';
import { buildPiBridgeState } from '../src/harness-sidecar/pi/piBridgeState.js';

test('full leverage smoke: pack markdown and bridge state on scaffolded workplace', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-leverage-smoke-'));
  try {
    await setupHeliosForge({ workspaceRoot });

    const candidateDir = path.join(workspaceRoot, '.harness', 'meta', 'skill-candidates', 'shadow-1');
    await mkdir(candidateDir, { recursive: true });
    await writeFile(path.join(candidateDir, 'candidate.json'), JSON.stringify({
      status: 'shadow_only',
      skill: { name: 'shadow-smoke' },
    }), 'utf8');
    await writeFile(path.join(candidateDir, 'SKILL.md'), '# Shadow\n\n## Purpose\nSmoke shadow skill\n', 'utf8');

    const pack = await buildPiBridgeContextPack({
      workspaceRoot,
      harnessConfig: { features: { localMemoryGraph: true, icr: { enabled: false } } },
    });
    const markdown = renderPiBridgeContextMarkdown(pack);
    assert.match(markdown, /\[Helios Forge\]/);
    assert.match(markdown, /Soul \/ oversoul/);

    const state = await buildPiBridgeState({ workspaceRoot });
    assert.equal(state.bridgeHealth.defaultPackageInstalled, true);
    assert.ok(Array.isArray(state.skillInventory.skills));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
