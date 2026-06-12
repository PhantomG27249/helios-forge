import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runMetaHarnessCampaign } from '../src/harness-sidecar/meta/metaHarnessCampaignRunner.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-meta-campaign-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('meta-harness campaign repeats propose evaluate log cycles and updates the Pareto frontier', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(path.join(workspaceRoot, 'active.txt'), 'do-not-touch\n', 'utf8');
    const proposerInputs = [];

    const result = await runMetaHarnessCampaign({
      campaign: {
        campaignId: 'paper_gap_campaign',
        workspaceRoot,
        target: 'meta-harness',
        baselineMetrics: { quality: 0.2, safety: 0.9, cost: 0.5, latency: 0.5 },
      },
      frontier: [{
        candidateId: 'baseline_frontier',
        metrics: { quality: 0.25, safety: 0.9, cost: 0.5, latency: 0.5 },
      }],
      maxCycles: 2,
      now: () => new Date('2026-06-12T12:00:00.000Z'),
      proposer: async (input) => {
        proposerInputs.push(input);
        return {
          candidateId: `meta_candidate_${input.cycleIndex}`,
          sourceFiles: {
            'runner.js': `export const cycle = ${input.cycleIndex};\n`,
          },
          config: { cycleIndex: input.cycleIndex },
          traceManifest: { traces: [{ traceId: `trace_${input.cycleIndex}` }] },
          metricManifest: { metrics: [{ name: 'quality' }] },
        };
      },
      variantRunner: async ({ cycleIndex, variant }) => ({
        replayReport: {
          replayId: `replay_${cycleIndex}`,
          variantId: variant.variantId,
          cases: [{ caseId: `case_${cycleIndex}`, passed: true }],
        },
      }),
      evaluator: async ({ cycleIndex, replayReport }) => ({
        metrics: {
          quality: 0.4 + cycleIndex * 0.2,
          safety: 0.95,
          cost: 0.4 - cycleIndex * 0.05,
          latency: 0.4,
        },
        replayReport,
      }),
    });

    assert.equal(result.schemaVersion, 1);
    assert.equal(result.campaignId, 'paper_gap_campaign');
    assert.equal(result.cycles.length, 2);
    assert.deepEqual(result.cycles.map((cycle) => cycle.candidate.candidateId), [
      'meta_candidate_0',
      'meta_candidate_1',
    ]);
    assert.equal(proposerInputs[0].frontier.length, 1);
    assert.equal(proposerInputs[1].previousReplayReports[0].replayId, 'replay_0');
    assert.equal(proposerInputs[1].frontier.some((entry) => entry.candidateId === 'meta_candidate_0'), true);
    assert.deepEqual(result.frontier.map((entry) => entry.candidateId), ['meta_candidate_1']);
    assert.equal(result.cycles[1].preference.evidenceOnly, true);
    assert.equal(result.cycles[1].variant.manifest.safeApply.activeWorkspaceMutation, false);

    const replayEvidence = JSON.parse(await readFile(
      path.join(result.cycles[1].run.runDir, 'replay-evidence.json'),
      'utf8',
    ));
    const sweep = JSON.parse(await readFile(path.join(result.cycles[1].run.runDir, 'sweep.json'), 'utf8'));
    const activeFile = await readFile(path.join(workspaceRoot, 'active.txt'), 'utf8');

    assert.equal(replayEvidence.report.replayId, 'replay_1');
    assert.deepEqual(replayEvidence.previousReplayReportIds, ['replay_0']);
    assert.equal(sweep.campaignId, 'paper_gap_campaign');
    assert.equal(sweep.cycleIndex, 1);
    assert.equal(activeFile, 'do-not-touch\n');
  });
});

test('meta-harness campaign materializes isolated source-tree variants without promotion authority', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(path.join(workspaceRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'runner.js'), 'export const baseline = true;\n', 'utf8');
    const variantCalls = [];

    const result = await runMetaHarnessCampaign({
      campaign: {
        campaignId: 'source_tree_campaign',
        workspaceRoot,
        target: 'meta-harness',
        sourceTree: {
          entrypoint: 'runner.js',
          sourcePaths: ['runner.js'],
          configPaths: ['package.json'],
          run: { command: 'node', args: ['runner.js'], timeoutMs: 1000 },
          collect: { replayPaths: ['.harness/replay/report.json'] },
        },
      },
      maxCycles: 1,
      proposer: async () => ({
        candidateId: 'source_tree_candidate',
        sourceFiles: {
          'candidate.js': 'export const candidate = true;\n',
        },
      }),
      variantRunner: {
        prepareVariant: async (input) => {
          variantCalls.push({ step: 'prepare', ...input });
          return {
            sourceTreeManifest: {
              entrypoint: input.entrypoint,
              sourceFiles: [{ path: 'runner.js' }],
              activeWorkspaceMutation: false,
              evidenceOnly: true,
            },
          };
        },
        runVariant: async (input) => {
          variantCalls.push({ step: 'run', ...input });
          return { result: { exitCode: 0, stdout: 'ok', stderr: '' } };
        },
        collectArtifacts: async (input) => {
          variantCalls.push({ step: 'collect', ...input });
          return {
            artifacts: {
              replay: { files: [{ path: 'variant-artifacts/replay/report.json' }] },
            },
          };
        },
      },
      evaluator: async () => ({
        metrics: { quality: 0.7, safety: 0.96, cost: 0.2, latency: 0.2 },
        replayReport: { replayId: 'source_tree_replay', cases: [{ caseId: 'heldout', passed: true }] },
      }),
    });

    assert.deepEqual(variantCalls.map((call) => call.step), ['prepare', 'run', 'collect']);
    assert.match(variantCalls[0].variantRoot, /source_tree_candidate$/);
    assert.equal(variantCalls[0].entrypoint, 'runner.js');
    assert.deepEqual(variantCalls[0].sourcePaths, ['runner.js']);
    assert.equal(variantCalls[1].command, 'node');
    assert.deepEqual(variantCalls[2].replayPaths, ['.harness/replay/report.json']);
    assert.equal(result.cycles[0].sourceTree.sourceTreeManifest.activeWorkspaceMutation, false);
    assert.equal(result.cycles[0].promotion.evidenceOnly, true);
    assert.equal(result.cycles[0].promotion.activeWorkspaceMutation, false);
    assert.equal(result.cycles[0].promotion.promotionAuthority, false);

    const promotion = JSON.parse(await readFile(path.join(result.cycles[0].run.runDir, 'promotion.json'), 'utf8'));
    assert.equal(promotion.promotionAuthority, false);
    assert.equal(promotion.activeWorkspaceMutation, false);
  });
});
