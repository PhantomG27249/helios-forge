import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadEvolutionBridgeContext } from '../src/harness-sidecar/pi/evolutionBridgeContext.js';

test('loadEvolutionBridgeContext reads goals and promotion queue count', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-evo-'));
  try {
    await mkdir(path.join(workspaceRoot, '.harness', 'meta'), { recursive: true });
    await mkdir(path.join(workspaceRoot, '.harness', 'meta', 'promotion-queue'), { recursive: true });
    await writeFile(path.join(workspaceRoot, '.harness', 'meta', 'evolution-goals.json'), JSON.stringify({
      goals: [{ label: 'Improve replay fidelity' }],
    }), 'utf8');
    await writeFile(path.join(workspaceRoot, '.harness', 'meta', 'promotion-queue', 'p1.json'), '{}', 'utf8');

    const result = await loadEvolutionBridgeContext({ workspaceRoot });
    assert.deepEqual(result.goals, ['Improve replay fidelity']);
    assert.equal(result.promotionQueueCount, 1);
    assert.equal(result.canPromote, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
