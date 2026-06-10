import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildHeliosSkillInventory } from '../src/harness-sidecar/pi/heliosSkillBridge.js';

async function withWorkspace(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'helios-skill-bridge-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

test('buildHeliosSkillInventory normalizes safe enabled skills from package, registry, runtime mount, and approved generated skills', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const repoRoot = path.join(workspaceRoot, 'repo');
    const packageRoot = path.join(repoRoot, 'packages', 'helios-research-harness');
    await writeJson(path.join(packageRoot, 'helios-package.json'), {
      id: 'helios-research-harness',
      name: 'Helios Research Harness',
      version: '0.1.0',
      skills: [
        { id: 'deep-research', name: 'Deep Research', path: 'skills/deep-research/SKILL.md' },
        { id: 'disabled-from-package', name: 'Disabled Package Skill', path: 'skills/disabled/SKILL.md', enabled: false },
      ],
    });
    await writeText(path.join(packageRoot, 'skills', 'deep-research', 'SKILL.md'), '# Deep Research\n\nUse for literature review.\n');

    const installedSkillPath = path.join(
      workspaceRoot,
      '.harness',
      'packages',
      'helios-research-harness',
      'skills',
      'visual-debugging',
      'SKILL.md',
    );
    await writeText(installedSkillPath, '# Visual Debugging\n\nUse for visual artifacts.\n');
    await writeJson(path.join(workspaceRoot, '.harness', 'capabilities.json'), {
      version: 1,
      capabilities: [
        {
          id: 'helios-research-harness:skill:visual-debugging',
          type: 'skill',
          capabilityId: 'visual-debugging',
          packageId: 'helios-research-harness',
          packageName: 'Helios Research Harness',
          packageVersion: '0.1.0',
          name: 'Visual Debugging',
          enabled: true,
          path: installedSkillPath,
        },
        {
          id: 'helios-research-harness:skill:disabled-registry',
          type: 'skill',
          capabilityId: 'disabled-registry',
          packageId: 'helios-research-harness',
          packageVersion: '0.1.0',
          name: 'Disabled Registry Skill',
          enabled: false,
          path: path.join(workspaceRoot, '.harness', 'packages', 'helios-research-harness', 'skills', 'disabled', 'SKILL.md'),
        },
      ],
    });
    await writeJson(path.join(workspaceRoot, '.harness', 'runtime', 'capabilities.mount.json'), {
      version: 1,
      capabilities: [
        {
          id: 'helios-research-harness:skill:meta-harness',
          type: 'skill',
          capabilityId: 'meta-harness',
          packageId: 'helios-research-harness',
          packageVersion: '0.1.0',
          name: 'Meta Harness',
          enabled: true,
          path: path.join(workspaceRoot, '.harness', 'packages', 'helios-research-harness', 'skills', 'meta-harness', 'SKILL.md'),
        },
      ],
    });

    const generatedSkillPath = path.join(
      workspaceRoot,
      '.harness',
      'packages',
      'generated-skills',
      'skills',
      'repair-loop',
      'SKILL.md',
    );
    await writeText(generatedSkillPath, '# Repair Loop\n\nUse for approved repair loops.\n');
    await writeJson(path.join(workspaceRoot, '.harness', 'meta', 'skill-candidates', 'repair-loop', 'candidate.json'), {
      candidateId: 'repair-loop',
      status: 'applied',
      skill: { id: 'repair-loop', name: 'Repair Loop', path: generatedSkillPath },
      rollback: { installRecordId: 'generated-skills:skill:repair-loop' },
    });

    const inventory = await buildHeliosSkillInventory({ workspaceRoot, repoRoot });

    assert.deepEqual(
      inventory.skills.map((skill) => skill.id),
      [
        'helios-research-harness:skill:deep-research',
        'helios-research-harness:skill:meta-harness',
        'helios-research-harness:skill:visual-debugging',
        'generated-skills:skill:repair-loop',
      ],
    );
    assert.deepEqual(inventory.skills.find((skill) => skill.name === 'Visual Debugging'), {
      id: 'helios-research-harness:skill:visual-debugging',
      name: 'Visual Debugging',
      source: 'capability_registry',
      version: '0.1.0',
      hash: null,
      relativePath: path.join('.harness', 'packages', 'helios-research-harness', 'skills', 'visual-debugging', 'SKILL.md'),
      enabled: true,
      description: 'Use for visual artifacts.',
    });
    assert.equal(inventory.diagnostics.ignored.some((entry) => entry.id === 'helios-research-harness:skill:disabled-registry'), true);
  });
});

test('buildHeliosSkillInventory ignores path escapes, external absolute paths, and unapproved generated candidates', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const repoRoot = path.join(workspaceRoot, 'repo');
    await writeJson(path.join(repoRoot, 'packages', 'helios-research-harness', 'helios-package.json'), {
      id: 'helios-research-harness',
      name: 'Helios Research Harness',
      version: '0.1.0',
      skills: [
        { id: 'safe', name: 'Safe Skill', path: 'skills/safe/SKILL.md' },
        { id: 'escape', name: 'Escape Skill', path: '../outside/SKILL.md' },
      ],
    });
    await writeText(path.join(repoRoot, 'packages', 'helios-research-harness', 'skills', 'safe', 'SKILL.md'), '# Safe Skill\n\nUse safely.\n');
    await writeJson(path.join(workspaceRoot, '.harness', 'capabilities.json'), {
      capabilities: [
        {
          id: 'external:skill:absolute',
          type: 'skill',
          name: 'External Absolute',
          enabled: true,
          path: path.resolve(tmpdir(), 'outside-workspace', 'SKILL.md'),
        },
      ],
    });
    await writeJson(path.join(workspaceRoot, '.harness', 'meta', 'skill-candidates', 'candidate-shadow', 'candidate.json'), {
      candidateId: 'candidate-shadow',
      status: 'shadow_only',
      skill: {
        id: 'candidate-shadow',
        name: 'Candidate Shadow',
        path: path.join(workspaceRoot, '.harness', 'packages', 'generated-skills', 'skills', 'candidate-shadow', 'SKILL.md'),
      },
    });

    const inventory = await buildHeliosSkillInventory({ workspaceRoot, repoRoot });

    assert.deepEqual(inventory.skills.map((skill) => skill.id), ['helios-research-harness:skill:safe']);
    assert.equal(inventory.diagnostics.ignored.some((entry) => entry.reason === 'path_outside_package'), true);
    assert.equal(inventory.diagnostics.ignored.some((entry) => entry.reason === 'path_outside_workspace'), true);
    assert.equal(inventory.diagnostics.ignored.some((entry) => entry.reason === 'generated_candidate_not_approved'), true);
  });
});
