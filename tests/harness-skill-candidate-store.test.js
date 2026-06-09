import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  listSkillCandidates,
  readSkillCandidate,
  readSourceSkillSnapshot,
  writeSkillCandidate,
  writeSkillCandidateEvaluation,
  writeSourceSkillSnapshot,
} from '../src/harness-sidecar/skills/skillCandidateStore.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-skill-store-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('skill candidate store writes shadow candidates under workspace meta only', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const saved = await writeSkillCandidate({
      workspaceRoot,
      candidate: {
        candidateId: 'skill_candidate_visual_debug_001',
        skill: { id: 'visual-debugging-repair', name: 'Visual Debugging Repair' },
        source: { rhoCaseIds: ['rho-1'], sourceSkillSnapshotId: 'skill_snapshot_debugging_001' },
      },
      skillMarkdown: '# Visual Debugging Repair\n\n## When to use\nUse for visual verifier misses.\n',
      evaluation: { score: 0.72 },
    });

    const candidateDir = path.join(
      workspaceRoot,
      '.harness',
      'meta',
      'skill-candidates',
      'skill_candidate_visual_debug_001',
    );
    assert.equal(saved.candidateId, 'skill_candidate_visual_debug_001');
    assert.equal(saved.status, 'shadow_only');
    assert.equal(saved.skill.path, path.join(candidateDir, 'SKILL.md'));
    assert.equal(await readFile(path.join(candidateDir, 'SKILL.md'), 'utf8'), '# Visual Debugging Repair\n\n## When to use\nUse for visual verifier misses.\n');

    const stored = JSON.parse(await readFile(path.join(candidateDir, 'candidate.json'), 'utf8'));
    assert.equal(stored.status, 'shadow_only');
    assert.equal(stored.safety.globalWrite, false);
    assert.equal(stored.source.sourceSkillSnapshotId, 'skill_snapshot_debugging_001');

    const evaluation = JSON.parse(await readFile(path.join(candidateDir, 'evaluation.json'), 'utf8'));
    assert.equal(evaluation.score, 0.72);

    const readBack = await readSkillCandidate({ workspaceRoot, candidateId: 'skill_candidate_visual_debug_001' });
    assert.equal(readBack.skillMarkdown.includes('Visual Debugging Repair'), true);
    assert.equal(readBack.evaluation.score, 0.72);
  });
});

test('skill candidate store rejects unsafe ids and never writes outside workspace', async () => {
  await withWorkspace(async (workspaceRoot) => {
    for (const candidateId of ['../escape', 'nested/path', 'bad id', 'C:\\Users\\jackj\\.codex\\skills\\x']) {
      await assert.rejects(
        () => writeSkillCandidate({
          workspaceRoot,
          candidate: { candidateId, skill: { id: 'bad', name: 'Bad' } },
          skillMarkdown: '# Bad\n',
        }),
        /unsafe id/i,
      );
    }

    await assert.rejects(
      () => writeSkillCandidate({
        workspaceRoot,
        candidate: {
          candidateId: 'safe_candidate',
          skill: { id: 'safe', name: 'Safe' },
          rollback: { packageId: 'C:\\Users\\jackj\\.pi\\agent\\extensions\\x' },
        },
        skillMarkdown: '# Safe\n',
      }),
      /global|outside workspace/i,
    );

    await assert.rejects(
      () => stat(path.join(workspaceRoot, '..', 'escape', 'SKILL.md')),
      /ENOENT/,
    );
  });
});

test('skill candidate evaluations are written beside the existing candidate', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeSkillCandidate({
      workspaceRoot,
      candidate: { candidateId: 'skill_candidate_eval_001', skill: { id: 'eval', name: 'Eval' } },
      skillMarkdown: '# Eval\n',
    });

    const saved = await writeSkillCandidateEvaluation({
      workspaceRoot,
      candidateId: 'skill_candidate_eval_001',
      evaluation: { totalScore: 0.81, checks: { safety: 1 } },
    });

    assert.equal(saved.totalScore, 0.81);
    const readBack = await readSkillCandidate({ workspaceRoot, candidateId: 'skill_candidate_eval_001' });
    assert.equal(readBack.evaluation.checks.safety, 1);
  });
});

test('skill candidate store lists candidates in deterministic id order', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeSkillCandidate({
      workspaceRoot,
      candidate: { candidateId: 'skill_candidate_b', skill: { id: 'b', name: 'B' } },
      skillMarkdown: '# B\n',
    });
    await writeSkillCandidate({
      workspaceRoot,
      candidate: { candidateId: 'skill_candidate_a', skill: { id: 'a', name: 'A' } },
      skillMarkdown: '# A\n',
    });

    const candidates = await listSkillCandidates({ workspaceRoot });
    assert.deepEqual(candidates.map((candidate) => candidate.candidateId), ['skill_candidate_a', 'skill_candidate_b']);
  });
});

test('source skill snapshots are immutable workspace-local provenance records', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const sourcePath = path.join(workspaceRoot, 'loaded-skills', 'debugging', 'SKILL.md');
    await mkdir(path.dirname(sourcePath), { recursive: true });

    const snapshot = await writeSourceSkillSnapshot({
      workspaceRoot,
      sourceSkill: {
        snapshotId: 'skill_snapshot_systematic_debugging_001',
        name: 'systematic-debugging',
        path: sourcePath,
        license: 'unknown',
        permission: 'snapshot_for_local_evaluation_only',
      },
      skillMarkdown: '# Systematic Debugging\n',
    });

    assert.equal(snapshot.immutable, true);
    assert.equal(snapshot.permission, 'snapshot_for_local_evaluation_only');
    const snapshotDir = path.join(
      workspaceRoot,
      '.harness',
      'meta',
      'skill-snapshots',
      'skill_snapshot_systematic_debugging_001',
    );
    assert.equal(snapshot.path, path.join(snapshotDir, 'SKILL.md'));
    assert.equal(await readFile(path.join(snapshotDir, 'SKILL.md'), 'utf8'), '# Systematic Debugging\n');

    await assert.rejects(
      () => writeSourceSkillSnapshot({
        workspaceRoot,
        sourceSkill: { snapshotId: 'skill_snapshot_systematic_debugging_001', name: 'again', path: sourcePath },
        skillMarkdown: '# Mutated\n',
      }),
      /immutable|already exists/i,
    );

    const readBack = await readSourceSkillSnapshot({
      workspaceRoot,
      snapshotId: 'skill_snapshot_systematic_debugging_001',
    });
    assert.equal(readBack.skillMarkdown, '# Systematic Debugging\n');
    assert.equal(readBack.metadata.sourcePath, sourcePath);
  });
});
