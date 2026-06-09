import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadCapabilityRegistry } from '../src/harness-sidecar/capabilities/capabilityStore.js';
import { applyApprovedSkillCandidate, rollbackAppliedSkillCandidate } from '../src/harness-sidecar/skills/skillCandidateApply.js';
import { writeSkillCandidate } from '../src/harness-sidecar/skills/skillCandidateStore.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-skill-apply-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function seedCandidate(workspaceRoot, overrides = {}) {
  return writeSkillCandidate({
    workspaceRoot,
    candidate: {
      candidateId: 'skill_candidate_visual_debug_001',
      target: 'skill_candidate',
      skill: {
        id: 'visual-debugging-repair',
        name: 'Visual Debugging Repair',
      },
      metrics: {
        holdoutImproved: true,
        triggerPrecision: 0.86,
        averageCost: 0.2,
      },
      safety: {
        passed: true,
        provenanceCompatible: true,
      },
      rollback: {
        available: true,
      },
      ...overrides,
    },
    skillMarkdown: '# Visual Debugging Repair\n\n## When to use\nUse for visual verifier misses.\n',
  });
}

test('approved skill candidate installs into workspace package and capability registry', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await seedCandidate(workspaceRoot);

    const applied = await applyApprovedSkillCandidate({
      workspaceRoot,
      candidateId: 'skill_candidate_visual_debug_001',
      approvals: [{ candidateId: 'skill_candidate_visual_debug_001', choice: 'approve', approver: 'human' }],
    });

    const expectedSkillPath = path.join(
      workspaceRoot,
      '.harness',
      'packages',
      'generated-skills',
      'skills',
      'visual-debugging-repair',
      'SKILL.md',
    );
    assert.equal(applied.capability.type, 'skill');
    assert.equal(applied.capability.id, 'generated-skills:skill:visual-debugging-repair');
    assert.equal(applied.capability.path, expectedSkillPath);
    assert.equal(await readFile(expectedSkillPath, 'utf8'), '# Visual Debugging Repair\n\n## When to use\nUse for visual verifier misses.\n');

    const registry = await loadCapabilityRegistry({ workspaceRoot });
    assert.equal(registry.byType.skill.length, 1);
    assert.equal(registry.byType.skill[0].metadata.candidateId, 'skill_candidate_visual_debug_001');

    const updatedCandidate = JSON.parse(await readFile(
      path.join(workspaceRoot, '.harness', 'meta', 'skill-candidates', 'skill_candidate_visual_debug_001', 'candidate.json'),
      'utf8',
    ));
    assert.equal(updatedCandidate.status, 'applied');
    assert.equal(updatedCandidate.rollback.packageId, 'generated-skills');
    assert.equal(updatedCandidate.rollback.installRecordId, 'generated-skills:skill:visual-debugging-repair');
  });
});

test('skill candidate apply refuses missing approval or unsafe evidence', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await seedCandidate(workspaceRoot);

    await assert.rejects(
      () => applyApprovedSkillCandidate({ workspaceRoot, candidateId: 'skill_candidate_visual_debug_001' }),
      /not promotable|human approval/i,
    );

    await seedCandidate(workspaceRoot, {
      candidateId: 'skill_candidate_unsafe_001',
      skill: { id: 'unsafe-skill', name: 'Unsafe Skill' },
      safety: { passed: true, provenanceCompatible: false },
    });
    await assert.rejects(
      () => applyApprovedSkillCandidate({
        workspaceRoot,
        candidateId: 'skill_candidate_unsafe_001',
        approvals: [{ candidateId: 'skill_candidate_unsafe_001', choice: 'approve' }],
      }),
      /not promotable|provenance/i,
    );
  });
});

test('skill candidate rollback removes workspace capability and installed file', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const seeded = await seedCandidate(workspaceRoot);
    const applied = await applyApprovedSkillCandidate({
      workspaceRoot,
      candidateId: seeded.candidateId,
      approvals: [{ candidateId: seeded.candidateId, choice: 'approve' }],
    });

    await stat(applied.capability.path);
    const rollback = await rollbackAppliedSkillCandidate({
      workspaceRoot,
      candidateId: seeded.candidateId,
    });

    assert.equal(rollback.removedCapabilityId, 'generated-skills:skill:visual-debugging-repair');
    const registry = await loadCapabilityRegistry({ workspaceRoot });
    assert.equal(registry.byType.skill.length, 0);
    await assert.rejects(() => stat(applied.capability.path), /ENOENT/);
  });
});
