import assert from 'node:assert/strict';
import { test } from 'node:test';

import { orchestrateNestedSwarm } from '../src/harness-sidecar/swarm/nestedSwarmOrchestrator.js';

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

test('orchestrates multiple SwarmCells and merges evolution evidence', async () => {
  const result = await orchestrateNestedSwarm({
    workspaceRoot: process.cwd(),
    cells: [
      { cellId: 'code-1', role: 'implementer', outputContract: { cellType: 'code' } },
      { cellId: 'memory-1', role: 'researcher', outputContract: { cellType: 'memory_rag' } },
    ],
    task: { id: 'task-1', prompt: 'implement feature' },
    commandAdapter: async () => ({
      taskOutput: { summary: 'done' },
      evolutionOutput: { hardCases: [{ id: 'hc-1' }] },
    }),
    featureFlags: { localMetaHarness: true },
  });

  assert.equal(result.cells.length, 2);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.canPromote, false);
  assert.ok(result.mergedEvolutionOutput);
  assert.ok(result.mergedEvolutionOutput.hardCaseTags.length >= 1);
});

test('orchestrates cells with bounded concurrency of three', async () => {
  const releases = Array.from({ length: 5 }, () => deferred());
  const started = [];
  let running = 0;
  let maxRunning = 0;

  const run = orchestrateNestedSwarm({
    workspaceRoot: process.cwd(),
    cells: releases.map((_, index) => ({
      cellId: `cell-${index + 1}`,
      role: 'implementer',
    })),
    task: { id: 'task-concurrency', prompt: 'stress concurrency' },
    commandAdapter: async ({ context }) => {
      const index = Number(String(context.cellId || '').replace('cell-', '')) - 1;
      started.push(context.cellId);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await releases[index].promise;
      running -= 1;
      return {
        summary: 'done',
        verifierEvidence: ['ok'],
        evolutionOutput: { hardCaseTags: [`tag-${context.cellId}`] },
      };
    },
  });

  await Promise.resolve();
  assert.equal(started.length, 3);
  assert.equal(maxRunning, 3);

  for (const release of releases) {
    release.resolve();
  }
  const result = await run;
  assert.equal(result.cells.length, 5);
  assert.equal(result.evidenceOnly, true);
});

test('merges evolution output from all cells without granting promotion', async () => {
  const result = await orchestrateNestedSwarm({
    workspaceRoot: process.cwd(),
    cells: [
      { cellId: 'code-1', role: 'implementer' },
      { cellId: 'verifier-1', role: 'verifier' },
    ],
    task: { id: 'task-merge', prompt: 'merge evolution' },
    commandAdapter: async ({ role }) => ({
      summary: `${role} done`,
      verifierEvidence: ['node --test'],
      evolutionOutput: role === 'implementer'
        ? { hardCaseTags: ['missing_context'], evidenceRefs: ['evidence-a'] }
        : { hardCaseTags: ['weak_verifier'], evidenceRefs: ['evidence-b'] },
    }),
  });

  assert.deepEqual(result.mergedEvolutionOutput.hardCaseTags.sort(), ['missing_context', 'weak_verifier']);
  assert.deepEqual(result.mergedEvolutionOutput.evidenceRefs.sort(), ['evidence-a', 'evidence-b']);
  assert.equal(result.mergedEvolutionOutput.durableApplyApproved, false);
  assert.equal(result.canPromote, false);
});
