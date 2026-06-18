import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { archiveCandidate } from '../src/harness-sidecar/meta/candidateArchive.js';
import { loadTaskEvolutionInputs } from '../src/harness-sidecar/meta/taskEvolutionInputs.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-task-evolution-inputs-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeTaskTrace({ workspaceRoot, taskId, events }) {
  const traceDir = path.join(workspaceRoot, '.harness', 'traces', taskId);
  await mkdir(traceDir, { recursive: true });
  const lines = events.map((event) => JSON.stringify(event)).join('\n');
  await writeFile(path.join(traceDir, 'events.jsonl'), `${lines}\n`, 'utf8');
}

test('loadTaskEvolutionInputs returns empty object when artifacts are missing', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const inputs = await loadTaskEvolutionInputs({
      workspaceRoot,
      taskId: 'task_missing',
    });
    assert.deepEqual(inputs, {});
  });
});

test('loadTaskEvolutionInputs reads latest runtime task meta candidate archive', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await archiveCandidate({
      workspaceRoot,
      candidate: {
        candidateId: 'runtime_task_alpha_bes_0',
        target: 'runtime_policy',
        sourceFiles: { 'policy.js': 'export const v = 0;\n' },
        config: { cycle: 0 },
      },
      candidateRun: {
        candidateId: 'runtime_task_alpha_bes_0',
        metrics: { quality: 0.61 },
      },
      traceSummary: { failureModes: ['tool_timeout'] },
      preference: { winner: 'runtime_task_alpha_bes_0' },
    });
    await archiveCandidate({
      workspaceRoot,
      candidate: {
        candidateId: 'runtime_task_alpha',
        target: 'runtime_policy',
        archivedAt: '2026-06-10T00:00:00.000Z',
      },
      candidateRun: { candidateId: 'runtime_task_alpha', metrics: { quality: 0.5 } },
      traceSummary: {},
      preference: {},
    });

    const inputs = await loadTaskEvolutionInputs({
      workspaceRoot,
      taskId: 'task_alpha',
    });

    assert.equal(inputs.metaCandidate.candidateId, 'runtime_task_alpha_bes_0');
    assert.equal(inputs.metaCandidate.candidate.sourceFiles['policy.js'], 'export const v = 0;\n');
    assert.equal(inputs.metaCandidate.candidate.config.cycle, 0);
    assert.equal(inputs.metaCandidate.candidateRun.metrics.quality, 0.61);
  });
});

test('loadTaskEvolutionInputs reads swarm champion from task trace summary events', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeTaskTrace({
      workspaceRoot,
      taskId: 'task_swarm',
      events: [
        { type: 'task.started', taskId: 'task_swarm', timestamp: '2026-06-12T10:00:00.000Z' },
        {
          type: 'swarm.champion_selected',
          taskId: 'task_swarm',
          timestamp: '2026-06-12T10:01:00.000Z',
          champion: {
            attemptId: 'attempt_champion',
            score: 0.88,
            patchStats: { changedLines: 12 },
          },
        },
      ],
    });

    const inputs = await loadTaskEvolutionInputs({
      workspaceRoot,
      taskId: 'task_swarm',
    });

    assert.equal(inputs.swarmChampion.attemptId, 'attempt_champion');
    assert.equal(inputs.swarmChampion.score, 0.88);
  });
});

test('loadTaskEvolutionInputs reads harness optimizer proposal artifact path from trace artifacts', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const artifactPath = path.join(
      workspaceRoot,
      '.harness',
      'traces',
      'task_meta',
      'artifacts',
      'meta-optimizer-proposal.json',
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, '{"selectedCandidateId":"runtime_task_meta"}\n', 'utf8');

    await writeTaskTrace({
      workspaceRoot,
      taskId: 'task_meta',
      events: [
        { type: 'task.started', taskId: 'task_meta', timestamp: '2026-06-12T10:00:00.000Z' },
        {
          type: 'meta.optimizer_proposed',
          taskId: 'task_meta',
          timestamp: '2026-06-12T10:02:00.000Z',
          artifacts: [{
            type: 'meta_optimizer_proposal',
            filename: 'meta-optimizer-proposal.json',
            path: artifactPath,
          }],
        },
      ],
    });

    const inputs = await loadTaskEvolutionInputs({
      workspaceRoot,
      taskId: 'task_meta',
    });

    assert.equal(inputs.harnessOptimizerProposalArtifactPath, artifactPath);
  });
});
