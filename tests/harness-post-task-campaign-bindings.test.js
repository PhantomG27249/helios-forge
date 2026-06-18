import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runMetaHarnessCampaign } from '../src/harness-sidecar/meta/metaHarnessCampaignRunner.js';
import { createPostTaskCampaignBindings } from '../src/harness-sidecar/meta/postTaskCampaignBindings.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-post-task-bindings-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('createPostTaskCampaignBindings defaults maxCycles to 3', () => {
  const bindings = createPostTaskCampaignBindings({
    task: { taskId: 'task_default' },
    replayReports: [],
    evolutionInputs: {},
    harnessConfig: {},
  });
  assert.equal(bindings.maxCycles, 3);
});

test('createPostTaskCampaignBindings reads maxCycles from harness evolution config', () => {
  const bindings = createPostTaskCampaignBindings({
    task: { taskId: 'task_config' },
    replayReports: [],
    evolutionInputs: {},
    harnessConfig: { evolution: { campaignMaxCycles: 5 } },
  });
  assert.equal(bindings.maxCycles, 5);
});

test('createPostTaskCampaignBindings proposer includes evolution input sourceFiles and config', async () => {
  const bindings = createPostTaskCampaignBindings({
    task: { taskId: 'task_feed' },
    replayReports: [{ reportId: 'replay_feed', aggregateScore: 0.71 }],
    evolutionInputs: {
      metaCandidate: {
        candidateId: 'runtime_task_feed',
        candidate: {
          candidateId: 'runtime_task_feed',
          sourceFiles: { 'runner.js': 'export const fed = true;\n' },
          config: { fedBy: 'meta_candidate' },
        },
      },
      swarmChampion: { attemptId: 'attempt_feed', score: 0.9 },
      harnessOptimizerProposalArtifactPath: '/tmp/meta-optimizer-proposal.json',
    },
    harnessConfig: {},
  });

  const proposal = await bindings.proposer({
    cycleIndex: 0,
    cycleId: 'campaign_0',
    target: 'meta-harness',
    frontier: [],
    priorContext: { priorVariants: [] },
    previousMetrics: null,
    previousCandidateIds: [],
    previousReplayReports: [],
  });

  assert.equal(proposal.candidateId, 'post-task-task_feed-0');
  assert.equal(proposal.sourceFiles['runner.js'], 'export const fed = true;\n');
  assert.equal(proposal.config.fedBy, 'meta_candidate');
  assert.equal(proposal.config.metaCandidateId, 'runtime_task_feed');
  assert.equal(proposal.config.swarmChampionAttemptId, 'attempt_feed');
  assert.equal(proposal.config.harnessOptimizerProposalArtifactPath, '/tmp/meta-optimizer-proposal.json');
  assert.deepEqual(proposal.config.replayReportIds, ['replay_feed']);
});

test('createPostTaskCampaignBindings evaluator uses replay aggregateScore instead of hard-coded quality', async () => {
  const bindings = createPostTaskCampaignBindings({
    task: { taskId: 'task_eval' },
    replayReports: [{
      reportId: 'replay_eval',
      aggregateScore: 0.72,
      metrics: { safety: 0.81, cost: 0.44, latency: 0.33 },
    }],
    evolutionInputs: {},
    harnessConfig: {},
  });

  const evaluation = await bindings.evaluator({
    replayReport: {
      replayId: 'variant_replay',
      aggregateScore: 0.72,
      metrics: { safety: 0.81, cost: 0.44, latency: 0.33 },
    },
  });

  assert.equal(evaluation.metrics.quality, 0.72);
  assert.notEqual(evaluation.metrics.quality, 0.9);
  assert.equal(evaluation.metrics.safety, 0.81);
  assert.equal(evaluation.metrics.cost, 0.44);
  assert.equal(evaluation.metrics.latency, 0.33);
});

test('createPostTaskCampaignBindings uses source-tree variant runner with manifest evidence', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(path.join(workspaceRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'runner.js'), 'export const baseline = true;\n', 'utf8');

    const bindings = createPostTaskCampaignBindings({
      task: { taskId: 'task_variant' },
      replayReports: [{ reportId: 'replay_variant', aggregateScore: 0.68 }],
      evolutionInputs: {
        metaCandidate: {
          candidateId: 'runtime_task_variant',
          candidate: {
            candidateId: 'runtime_task_variant',
            sourceFiles: { 'candidate.js': 'export const candidate = true;\n' },
          },
        },
      },
      harnessConfig: { evolution: { campaignMaxCycles: 1 } },
      commandRunner: async ({ cwd, command, args }) => {
        await mkdir(path.join(cwd, '.harness', 'replay'), { recursive: true });
        await writeFile(
          path.join(cwd, '.harness', 'replay', 'report.json'),
          JSON.stringify({
            replayId: 'post_task_source_tree_replay',
            command,
            args,
            cases: [{ caseId: 'heldout', passed: true }],
          }),
          'utf8',
        );
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });

    assert.equal(typeof bindings.sourceTree?.commandRunner, 'function');
    assert.equal(bindings.variantRunner, undefined);

    const result = await runMetaHarnessCampaign({
      campaign: {
        campaignId: 'post_task_bindings_campaign',
        workspaceRoot,
        target: 'meta-harness',
        sourceTree: bindings.sourceTree,
      },
      maxCycles: bindings.maxCycles,
      proposer: bindings.proposer,
      evaluator: bindings.evaluator,
      variantRunner: bindings.variantRunner,
    });

    assert.equal(result.cycles.length, 1);
    assert.equal(result.cycles[0].sourceTree.sourceTreeManifest.entrypoint, 'runner.js');
    assert.equal(result.cycles[0].sourceTree.sourceTreeManifest.activeWorkspaceMutation, false);
    assert.equal(result.cycles[0].metrics.quality, 0.68);
    assert.equal(result.cycles[0].replayReport.replayId, 'post_task_source_tree_replay');
    assert.equal(result.cycles[0].promotion.evidenceOnly, true);
    assert.equal(result.cycles[0].promotion.activeWorkspaceMutation, false);
  });
});
