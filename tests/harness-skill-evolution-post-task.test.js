import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  loadRecentTraceSummaries,
  runSkillEvolutionPostTask,
  skillEvolutionEnabled,
} from '../src/harness-sidecar/skills/skillEvolutionPostTask.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-skill-evolution-post-task-'));
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

test('skillEvolutionEnabled defaults true unless features.skillEvolution is false', () => {
  assert.equal(skillEvolutionEnabled({}), true);
  assert.equal(skillEvolutionEnabled({ features: {} }), true);
  assert.equal(skillEvolutionEnabled({ features: { skillEvolution: true } }), true);
  assert.equal(skillEvolutionEnabled({ features: { skillEvolution: false } }), false);
});

test('loadRecentTraceSummaries reads recent traces with failure modes', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeTaskTrace({
      workspaceRoot,
      taskId: 'task_verifier_gap',
      events: [
        {
          type: 'task.started',
          taskId: 'task_verifier_gap',
          timestamp: '2026-06-20T10:00:00.000Z',
        },
        {
          type: 'verifier.failure',
          taskId: 'task_verifier_gap',
          timestamp: '2026-06-20T10:01:00.000Z',
          category: 'missing_verifier_evidence',
          message: 'Replay proof missing verifier artifact',
        },
      ],
    });

    const traces = await loadRecentTraceSummaries({ workspaceRoot, limit: 8 });
    assert.equal(traces.length, 1);
    assert.equal(traces[0].traceId, 'task_verifier_gap');
    assert.deepEqual(traces[0].failureModes, ['missing_verifier_evidence']);
  });
});

test('runSkillEvolutionPostTask skips when skill evolution is disabled', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runSkillEvolutionPostTask({
      workspaceRoot,
      harnessConfig: { features: { skillEvolution: false } },
      task: { taskId: 'task_disabled' },
    });

    assert.equal(result.skipped, 'skill_evolution_disabled');
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.deepEqual(result.needs, []);
    assert.deepEqual(result.persisted, []);
  });
});

test('runSkillEvolutionPostTask no-ops on empty coreset', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await runSkillEvolutionPostTask({
      workspaceRoot,
      harnessConfig: {},
      task: { taskId: 'task_empty' },
    });

    assert.equal(result.skipped, 'empty_coreset');
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.deepEqual(result.persisted, []);
  });
});

test('runSkillEvolutionPostTask persists verifier-evidence skill candidates from trace failures', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeTaskTrace({
      workspaceRoot,
      taskId: 'task_verifier_gap',
      events: [
        {
          type: 'task.started',
          taskId: 'task_verifier_gap',
          timestamp: '2026-06-20T10:00:00.000Z',
        },
        {
          type: 'verifier.failure',
          taskId: 'task_verifier_gap',
          timestamp: '2026-06-20T10:01:00.000Z',
          category: 'missing_verifier_evidence',
          message: 'Replay proof missing verifier artifact',
        },
      ],
    });

    const fixedNow = () => new Date('2026-06-20T12:00:00.000Z');
    const result = await runSkillEvolutionPostTask({
      workspaceRoot,
      harnessConfig: {},
      task: { taskId: 'task_verifier_gap' },
      deps: { now: fixedNow },
    });

    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.equal(result.skipped, undefined);
    assert.equal(result.needs.length >= 1, true);
    assert.equal(result.needs[0].needId, 'skill_need_verifier_evidence_repair');
    assert.equal(result.persisted.length, 2);
    assert.equal(typeof result.schedulerAction?.type, 'string');
    assert.notEqual(result.schedulerAction?.install, true);

    const candidatesDir = path.join(workspaceRoot, '.harness', 'meta', 'skill-candidates');
    const entries = await readdir(candidatesDir);
    assert.equal(entries.length, 2);

    for (const persisted of result.persisted) {
      assert.equal(persisted.needId, 'skill_need_verifier_evidence_repair');
      assert.equal(persisted.evaluation.recommendation, 'eligible_for_shadow_review');
      assert.equal(persisted.evaluation.safety.clean, true);
      await stat(persisted.path);
      const candidateJson = JSON.parse(
        await readFile(path.join(candidatesDir, persisted.candidateId, 'candidate.json'), 'utf8'),
      );
      assert.equal(candidateJson.status, 'shadow_only');
      assert.equal(candidateJson.safety.globalWrite, false);
      assert.deepEqual(candidateJson.source.failureModes, ['missing_verifier_evidence']);
    }
  });
});
