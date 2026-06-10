import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { updateHarnessFrontier } from '../src/harness-sidecar/meta/harnessFrontier.js';
import { runHarnessExperiment } from '../src/harness-sidecar/meta/harnessExperimentRunner.js';
import { createHarnessRun } from '../src/harness-sidecar/meta/harnessRunStore.js';
import {
  createHarnessVariantWorkspace,
  readHarnessVariantProposerContext,
  runHarnessVariantCycles,
} from '../src/harness-sidecar/meta/harnessVariantWorkspace.js';

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

test('variant workspace writes isolated runnable source config trace and metric manifest', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const variant = await createHarnessVariantWorkspace({
      workspaceRoot,
      cycleId: 'cycle_1',
      candidate: {
        candidateId: 'cand_variant',
        target: 'meta-harness',
        patch: { applied: false },
      },
      sourceFiles: {
        'runner.js': 'export function run() { return true; }\n',
      },
      config: {
        evalCases: ['case_a'],
        thresholds: { safety: 0.9 },
      },
      traceManifest: {
        traces: [{ traceId: 'trace_a', path: 'traces/trace_a/events.jsonl' }],
      },
      metricManifest: {
        metrics: [{ name: 'quality', source: 'candidate_eval' }],
      },
    });

    const manifest = JSON.parse(await readFile(variant.files.manifest, 'utf8'));
    const source = await readFile(path.join(variant.variantDir, 'src', 'runner.js'), 'utf8');

    assert.equal(manifest.candidate.candidateId, 'cand_variant');
    assert.equal(manifest.safeApply.evidenceOnly, true);
    assert.equal(manifest.safeApply.activeWorkspaceMutation, false);
    assert.equal(manifest.artifacts.source[0].path, 'src/runner.js');
    assert.equal(manifest.artifacts.config.path, 'config.json');
    assert.equal(manifest.artifacts.trace.path, 'trace-manifest.json');
    assert.equal(manifest.artifacts.metrics.path, 'metric-manifest.json');
    assert.match(source, /export function run/);
  });
});

test('variant workspace materializes trace and metric artifacts for proposer context', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const variant = await createHarnessVariantWorkspace({
      workspaceRoot,
      cycleId: 'cycle_artifacts',
      candidate: {
        candidateId: 'cand_artifacts',
        target: 'meta-harness',
      },
      lineage: {
        parentVariantId: 'cand_parent',
        previousCandidateIds: ['cand_parent'],
      },
      sourceFiles: {
        'runner.js': 'export function run() { return "artifact-context"; }\n',
      },
      config: {
        evalCases: ['case_artifact'],
      },
      traceManifest: {
        traces: [{ traceId: 'trace_artifact', path: 'traces/trace_artifact/events.jsonl' }],
      },
      metricManifest: {
        metrics: [{ name: 'quality', path: 'metrics/quality.json' }],
      },
      traceArtifacts: {
        'trace_artifact/events.jsonl': '{"event":"proposal_failed","reason":"thin_context"}\n',
      },
      metricArtifacts: {
        'quality.json': { quality: 0.74, safety: 0.96 },
      },
    });

    const manifest = JSON.parse(await readFile(variant.files.manifest, 'utf8'));
    const traceArtifact = await readFile(path.join(variant.variantDir, 'traces', 'trace_artifact', 'events.jsonl'), 'utf8');
    const metricArtifact = JSON.parse(await readFile(path.join(variant.variantDir, 'metrics', 'quality.json'), 'utf8'));
    const context = await readHarnessVariantProposerContext({
      workspaceRoot,
      variantRefs: [variant],
    });

    assert.equal(manifest.lineage.parentVariantId, 'cand_parent');
    assert.equal(manifest.artifacts.trace.files[0].path, 'traces/trace_artifact/events.jsonl');
    assert.equal(manifest.artifacts.metrics.files[0].path, 'metrics/quality.json');
    assert.match(traceArtifact, /thin_context/);
    assert.equal(metricArtifact.quality, 0.74);
    assert.equal(context.priorVariants[0].sourceSummaries[0].path, 'src/runner.js');
    assert.match(context.priorVariants[0].sourceSummaries[0].excerpt, /artifact-context/);
    assert.match(context.priorVariants[0].traceSummaries[0].excerpt, /proposal_failed/);
    assert.equal(context.priorVariants[0].metricSummaries[0].json.quality, 0.74);
  });
});

test('variant workspace rejects traversal in materialized trace and metric artifact paths', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await assert.rejects(
      () => createHarnessVariantWorkspace({
        workspaceRoot,
        cycleId: 'cycle_escape',
        candidate: { candidateId: 'cand_escape' },
        traceArtifacts: {
          '../outside.jsonl': 'escaped',
        },
      }),
      /Unsafe artifact path/,
    );

    await assert.rejects(
      () => createHarnessVariantWorkspace({
        workspaceRoot,
        cycleId: 'cycle_escape_metric',
        candidate: { candidateId: 'cand_escape_metric' },
        metricArtifacts: {
          '..\\outside.json': { escaped: true },
        },
      }),
      /Unsafe artifact path/,
    );
  });
});

test('variant workspace refuses to write through symlinked source directories', async (t) => {
  await withWorkspace(async (workspaceRoot) => {
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'helios-variant-outside-'));
    const sourceDir = path.join(
      workspaceRoot,
      '.harness',
      'meta',
      'harness-variants',
      'cycle_link',
      'cand_link',
      'src',
    );
    await mkdir(path.dirname(sourceDir), { recursive: true });
    try {
      await symlink(outsideRoot, sourceDir, 'junction');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        await rm(outsideRoot, { recursive: true, force: true });
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      () => createHarnessVariantWorkspace({
        workspaceRoot,
        cycleId: 'cycle_link',
        candidate: { candidateId: 'cand_link' },
        sourceFiles: {
          'runner.js': 'export const escaped = true;\n',
        },
      }),
      /symlink|junction|escapes workspace/i,
    );
    await assert.rejects(
      () => readFile(path.join(outsideRoot, 'runner.js'), 'utf8'),
      /ENOENT/,
    );
    await rm(outsideRoot, { recursive: true, force: true });
  });
});

test('harness run store refuses to write through symlinked run directories', async (t) => {
  await withWorkspace(async (workspaceRoot) => {
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'helios-run-outside-'));
    const runDir = path.join(
      workspaceRoot,
      '.harness',
      'meta',
      'harness-runs',
      'run_link',
    );
    await mkdir(path.dirname(runDir), { recursive: true });
    try {
      await symlink(outsideRoot, runDir, 'junction');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        await rm(outsideRoot, { recursive: true, force: true });
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      () => createHarnessRun({
        workspaceRoot,
        runId: 'run_link',
        candidate: { candidateId: 'cand_link' },
      }),
      /symlink|junction|escapes workspace/i,
    );
    await assert.rejects(
      () => readFile(path.join(outsideRoot, 'candidate.json'), 'utf8'),
      /ENOENT/,
    );
    await rm(outsideRoot, { recursive: true, force: true });
  });
});

test('variant cycle runner repeats propose evaluate and logs evidence-only harness runs', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const proposed = [];
    const result = await runHarnessVariantCycles({
      workspaceRoot,
      cyclePrefix: 'meta_loop',
      cycles: 2,
      target: 'meta-harness',
      traceSummary: { failureModes: ['weak_replay'] },
      propose: async ({ cycleIndex, previousMetrics }) => {
        proposed.push({ cycleIndex, previousMetrics });
        return {
          candidateId: `cand_cycle_${cycleIndex}`,
          sourceFiles: {
            'runner.js': `export const cycle = ${cycleIndex};\n`,
          },
          config: { cycleIndex },
          traceManifest: { traces: [{ traceId: `trace_${cycleIndex}` }] },
          metricManifest: { metrics: [{ name: 'quality', cycleIndex }] },
        };
      },
      evaluate: async ({ cycleIndex }) => ({
        quality: 0.5 + (cycleIndex * 0.1),
        safety: 0.95,
        cost: 0.2,
        latency: 0.2,
      }),
    });

    assert.equal(result.cycles.length, 2);
    assert.equal(result.cycles[0].candidate.candidateId, 'cand_cycle_0');
    assert.equal(result.cycles[1].candidate.candidateId, 'cand_cycle_1');
    assert.equal(proposed[1].previousMetrics.quality, 0.5);

    const manifest = JSON.parse(await readFile(result.cycles[1].variant.files.manifest, 'utf8'));
    const promotion = JSON.parse(await readFile(path.join(result.cycles[1].run.runDir, 'promotion.json'), 'utf8'));
    const sweep = JSON.parse(await readFile(path.join(result.cycles[1].run.runDir, 'sweep.json'), 'utf8'));

    assert.equal(manifest.safeApply.authority, 'advisory');
    assert.equal(promotion.preference.evidenceOnly, true);
    assert.equal(sweep.cycleIndex, 1);
    assert.deepEqual(sweep.previousCandidateIds, ['cand_cycle_0']);
  });
});

test('variant cycle runner supplies prior source trace and metric context to proposers', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const proposerContexts = [];
    await runHarnessVariantCycles({
      workspaceRoot,
      cyclePrefix: 'context_loop',
      cycles: 2,
      target: 'meta-harness',
      propose: async ({ cycleIndex, priorContext }) => {
        proposerContexts.push(priorContext);
        return {
          candidateId: `cand_context_${cycleIndex}`,
          sourceFiles: {
            'runner.js': `export const proposal = "context-${cycleIndex}";\n`,
          },
          traceArtifacts: {
            [`trace_${cycleIndex}/events.jsonl`]: `{"cycle":${cycleIndex},"event":"observed"}\n`,
          },
          metricArtifacts: {
            [`quality_${cycleIndex}.json`]: { quality: 0.5 + cycleIndex },
          },
        };
      },
      evaluate: async ({ cycleIndex }) => ({
        quality: 0.5 + cycleIndex,
        safety: 0.95,
        cost: 0.2,
        latency: 0.2,
      }),
    });

    assert.deepEqual(proposerContexts[0].priorVariants, []);
    assert.equal(proposerContexts[1].priorVariants[0].variantId, 'cand_context_0');
    assert.match(proposerContexts[1].priorVariants[0].sourceSummaries[0].excerpt, /context-0/);
    assert.match(proposerContexts[1].priorVariants[0].traceSummaries[0].excerpt, /observed/);
    assert.equal(proposerContexts[1].priorVariants[0].metricSummaries[0].json.quality, 0.5);
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
