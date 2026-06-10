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

test('harness run store persists source config trace metric and sweep lineage artifacts', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const run = await createHarnessRun({
      workspaceRoot,
      runId: 'run_lineage',
      candidate: { candidateId: 'cand_lineage', family: 'rho-scale' },
      lineage: {
        source: { files: ['src/harness-sidecar/rho/replayBatchRunner.js'], commit: 'abc123' },
        config: { profile: 'rho-scale', groupSize: 2 },
        trace: { traceIds: ['trace_a', 'trace_b'] },
        metrics: { objective: 'heldout_replay', schemaVersion: 1 },
      },
      traceManifest: {
        traces: [{ traceId: 'trace_a', path: 'traces/trace_a/events.jsonl' }],
      },
      metricLineage: {
        metrics: [{ name: 'validation_pass_rate', source: 'self_validation' }],
      },
      replayEvidence: {
        cases: [{ caseId: 'case_family', preferredCandidateId: 'cand_lineage' }],
      },
      sweep: {
        sweepId: 'sweep_rho_001',
        repeatedRun: 3,
        candidateFamily: ['cand_lineage', 'cand_other'],
      },
    });

    const lineage = JSON.parse(await readFile(path.join(run.runDir, 'lineage.json'), 'utf8'));
    const traceManifest = JSON.parse(await readFile(path.join(run.runDir, 'trace-manifest.json'), 'utf8'));
    const metricLineage = JSON.parse(await readFile(path.join(run.runDir, 'metric-lineage.json'), 'utf8'));
    const replayEvidence = JSON.parse(await readFile(path.join(run.runDir, 'replay-evidence.json'), 'utf8'));
    const sweep = JSON.parse(await readFile(path.join(run.runDir, 'sweep.json'), 'utf8'));

    assert.equal(lineage.source.commit, 'abc123');
    assert.equal(traceManifest.traces[0].traceId, 'trace_a');
    assert.equal(metricLineage.metrics[0].source, 'self_validation');
    assert.equal(replayEvidence.cases[0].preferredCandidateId, 'cand_lineage');
    assert.deepEqual(sweep.candidateFamily, ['cand_lineage', 'cand_other']);
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

test('experiment runner stores replay and sweep lineage with persisted runs', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runHarnessExperiment({
      workspaceRoot,
      runId: 'run_replay_lineage',
      candidate: { candidateId: 'cand_replay' },
      baselineRunner: async () => ({ quality: 0.5, safety: 0.9, cost: 0.3, latency: 0.3 }),
      candidateRunner: async () => ({ quality: 0.7, safety: 0.9, cost: 0.3, latency: 0.3 }),
      lineage: {
        source: { files: ['src/harness-sidecar/meta/harnessExperimentRunner.js'] },
        config: { profile: 'rho-scale' },
      },
      replayEvidence: {
        familySummary: { preferredCandidateId: 'cand_replay' },
      },
      sweep: {
        sweepId: 'sweep_meta_001',
        repeatedRun: 2,
      },
    });

    const lineage = JSON.parse(await readFile(path.join(result.run.runDir, 'lineage.json'), 'utf8'));
    const replayEvidence = JSON.parse(await readFile(path.join(result.run.runDir, 'replay-evidence.json'), 'utf8'));
    const sweep = JSON.parse(await readFile(path.join(result.run.runDir, 'sweep.json'), 'utf8'));

    assert.equal(lineage.config.profile, 'rho-scale');
    assert.equal(replayEvidence.familySummary.preferredCandidateId, 'cand_replay');
    assert.equal(sweep.repeatedRun, 2);
  });
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
