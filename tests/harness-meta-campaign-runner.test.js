import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
          commandRunner: async ({ cwd, command, args }) => {
            await mkdir(path.join(cwd, '.harness', 'replay'), { recursive: true });
            await writeFile(
              path.join(cwd, '.harness', 'replay', 'report.json'),
              JSON.stringify({
                replayId: 'source_tree_replay',
                command,
                args,
                cases: [{ caseId: 'heldout', passed: true }],
              }),
              'utf8',
            );
            return { exitCode: 0, stdout: 'ok', stderr: '' };
          },
        },
      },
      maxCycles: 1,
      proposer: async () => ({
        candidateId: 'source_tree_candidate',
        sourceFiles: {
          'candidate.js': 'export const candidate = true;\n',
        },
      }),
      evaluator: async () => ({
        metrics: { quality: 0.7, safety: 0.96, cost: 0.2, latency: 0.2 },
      }),
    });

    assert.equal(result.cycles[0].sourceTree.sourceTreeManifest.entrypoint, 'runner.js');
    assert.deepEqual(
      result.cycles[0].sourceTree.artifacts.replay.files.map((file) => file.path),
      ['variant-artifacts/replay/report.json'],
    );
    assert.equal(result.cycles[0].replayReport.replayId, 'source_tree_replay');
    assert.equal(result.cycles[0].replayReport.command, 'node');
    assert.equal(result.cycles[0].sourceTree.sourceTreeManifest.activeWorkspaceMutation, false);
    assert.equal(result.cycles[0].promotion.evidenceOnly, true);
    assert.equal(result.cycles[0].promotion.activeWorkspaceMutation, false);
    assert.equal(result.cycles[0].promotion.promotionAuthority, false);

    const promotion = JSON.parse(await readFile(path.join(result.cycles[0].run.runDir, 'promotion.json'), 'utf8'));
    const replayEvidence = JSON.parse(await readFile(
      path.join(result.cycles[0].run.runDir, 'replay-evidence.json'),
      'utf8',
    ));
    assert.equal(promotion.promotionAuthority, false);
    assert.equal(promotion.activeWorkspaceMutation, false);
    assert.equal(replayEvidence.report.replayId, 'source_tree_replay');
  });
});

test('meta-harness campaign hides active workspace roots from variant runners and rejects mutation claims', async () => {
  await withWorkspace(async (workspaceRoot) => {
    let observedInput = null;

    await assert.rejects(
      () => runMetaHarnessCampaign({
        campaign: {
          campaignId: 'mutation_boundary_campaign',
          workspaceRoot,
        },
        maxCycles: 1,
        proposer: async () => ({ candidateId: 'mutation_candidate' }),
        variantRunner: async (input) => {
          observedInput = input;
          return {
            activeWorkspaceMutation: true,
          };
        },
        evaluator: async () => ({
          metrics: { quality: 0.4, safety: 0.9, cost: 0.3, latency: 0.3 },
        }),
      }),
      /active workspace mutation/i,
    );

    assert.equal(observedInput.workspaceRoot, undefined);
    assert.equal(observedInput.campaign.workspaceRoot, undefined);
    assert.equal(observedInput.variantRoot, undefined);
    assert.equal(observedInput.variant.variantDir, undefined);
    assert.equal(JSON.stringify(observedInput).includes(workspaceRoot), false);
  });
});

test('meta-harness campaign strips proposer mutation and promotion claims from candidate artifacts', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runMetaHarnessCampaign({
      campaign: {
        campaignId: 'proposal_claim_campaign',
        workspaceRoot,
      },
      maxCycles: 1,
      proposer: async () => ({
        candidateId: 'claim_candidate',
        activeWorkspaceMutation: true,
        promotionAuthority: true,
        canPromote: true,
        applied: true,
        durableApplyApproved: true,
      }),
      evaluator: async () => ({
        metrics: { quality: 0.4, safety: 0.9, cost: 0.3, latency: 0.3 },
      }),
    });

    const candidateArtifact = JSON.parse(await readFile(
      path.join(result.cycles[0].run.runDir, 'candidate.json'),
      'utf8',
    ));

    assert.equal(result.cycles[0].candidate.activeWorkspaceMutation, false);
    assert.equal(result.cycles[0].candidate.promotionAuthority, false);
    assert.equal(result.cycles[0].candidate.canPromote, false);
    assert.equal(result.cycles[0].candidate.applied, false);
    assert.equal(result.cycles[0].candidate.durableApplyApproved, false);
    assert.equal(candidateArtifact.activeWorkspaceMutation, false);
    assert.equal(candidateArtifact.promotionAuthority, false);
    assert.equal(candidateArtifact.canPromote, false);
    assert.equal(candidateArtifact.applied, false);
    assert.equal(candidateArtifact.durableApplyApproved, false);
  });
});
