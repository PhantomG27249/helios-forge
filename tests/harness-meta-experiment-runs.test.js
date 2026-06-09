import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { updateHarnessFrontier } from '../src/harness-sidecar/meta/harnessFrontier.js';
import { runHarnessExperiment } from '../src/harness-sidecar/meta/harnessExperimentRunner.js';
import { createHarnessRun } from '../src/harness-sidecar/meta/harnessRunStore.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-harness-run-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('creates a harness run directory with candidate metadata', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const run = await createHarnessRun({
      workspaceRoot,
      runId: 'run_1',
      candidate: { candidateId: 'cand_1' },
      localAgentSummary: { cellId: 'code' },
      memoryProposals: [{ factId: 'fact_1' }],
    });

    const candidate = JSON.parse(await readFile(path.join(run.runDir, 'candidate.json'), 'utf8'));
    assert.equal(candidate.candidateId, 'cand_1');
  });
});

test('harness run store rejects duplicate run ids instead of overwriting evidence', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await createHarnessRun({
      workspaceRoot,
      runId: 'run_1',
      candidate: { candidateId: 'cand_1' },
    });

    await assert.rejects(
      createHarnessRun({
        workspaceRoot,
        runId: 'run_1',
        candidate: { candidateId: 'cand_2' },
      }),
      /already exists/,
    );
  });
});


test('experiment runner prefers candidate when metrics dominate baseline', async () => {
  const result = await runHarnessExperiment({
    candidate: { candidateId: 'cand_1' },
    baselineRunner: async () => ({ quality: 0.5, safety: 0.9, cost: 0.2, latency: 0.2 }),
    candidateRunner: async () => ({ quality: 0.7, safety: 0.9, cost: 0.2, latency: 0.2 }),
  });

  assert.equal(result.preference.preferred, 'candidate');
});

test('frontier keeps non-dominated candidate', () => {
  const frontier = updateHarnessFrontier({
    current: [],
    candidate: {
      candidateId: 'cand_1',
      metrics: { quality: 0.8, safety: 0.9, cost: 0.2, latency: 0.2 },
    },
  });

  assert.equal(frontier.length, 1);
});

test('frontier replaces existing candidate id instead of duplicating it', () => {
  const frontier = updateHarnessFrontier({
    current: [{
      candidateId: 'cand_1',
      metrics: { quality: 0.8, safety: 0.8, cost: 0.3, latency: 0.3 },
      note: 'old',
    }],
    candidate: {
      candidateId: 'cand_1',
      metrics: { quality: 0.8, safety: 0.8, cost: 0.3, latency: 0.3 },
      note: 'new',
    },
  });

  assert.equal(frontier.length, 1);
  assert.equal(frontier[0].metrics.quality, 0.8);
  assert.equal(frontier[0].note, 'new');
});
