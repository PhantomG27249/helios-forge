import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSkillGenome,
  generateSkillCandidates,
  renderSkillMarkdown,
} from '../src/harness-sidecar/skills/skillEvolution.js';

const skillNeed = {
  needId: 'skill_need_visual_debugging_repair',
  title: 'Visual Debugging Repair',
  failureModes: ['visual_false_negative', 'missing_artifact_context'],
  evidence: [{ traceId: 'trace-1', reason: 'layout overlap missed' }],
  targetCapabilities: ['browser.preview', 'visual.verifier.run'],
  sourceSkill: {
    snapshotId: 'skill_snapshot_systematic_debugging_001',
    name: 'systematic-debugging',
    path: 'C:\\Users\\jackj\\.codex\\superpowers\\skills\\systematic-debugging\\SKILL.md',
  },
  scaffold: {
    source: 'smithery',
    qualifiedName: 'anthropics/skill-creator',
    url: 'https://smithery.ai/skills/anthropics/skill-creator',
    usage: 'structure_and_rubric_seed',
  },
};

test('skill evolution creates multiple shadow-only genomes from one skill need', () => {
  const candidates = generateSkillCandidates({
    skillNeed,
    count: 3,
    now: () => new Date('2026-06-09T10:00:00.000Z'),
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates.every((candidate) => candidate.status === 'shadow_only'), true);
  assert.equal(candidates.every((candidate) => candidate.target === 'skill_candidate'), true);
  assert.deepEqual(candidates[0].genome.lineage.sourceSnapshotId, 'skill_snapshot_systematic_debugging_001');
  assert.equal(candidates[0].genome.scaffold.qualifiedName, 'anthropics/skill-creator');
  assert.deepEqual(candidates[0].genome.forbiddenActions, [
    'write_global_skill_directories',
    'weaken_approval_policy',
    'skip_verifier_evidence',
    'store_or_expose_secrets',
  ]);
  assert.equal(candidates[0].candidate.status, 'shadow_only');
  assert.match(candidates[0].skillMarkdown, /## Source Skill Lineage/);
});

test('skill evolution decomposes quality goals and recombines parent sections', () => {
  const genome = createSkillGenome({
    skillNeed,
    variant: 'evidence_first',
    parentSections: {
      workflowSteps: ['Reproduce the failing visual trace before changing code.'],
      requiredEvidence: ['Before and after screenshots.'],
    },
  });

  assert.deepEqual(genome.qualitySubgoals, [
    'trigger_precision',
    'workflow_specificity',
    'verifier_evidence',
    'safety_boundaries',
    'cost_latency_awareness',
  ]);
  assert.equal(genome.workflowSteps.includes('Reproduce the failing visual trace before changing code.'), true);
  assert.equal(genome.requiredEvidence.includes('Before and after screenshots.'), true);
});

test('skill markdown renders required sections and strict safety constraints', () => {
  const genome = createSkillGenome({ skillNeed, variant: 'baseline' });
  const markdown = renderSkillMarkdown({ genome });

  for (const heading of [
    '## Purpose',
    '## When To Use',
    '## When Not To Use',
    '## Source Skill Lineage',
    '## Scaffold Lineage',
    '## Required Evidence',
    '## Workflow',
    '## Safety Constraints',
    '## Verification Checklist',
    '## Escalation Behavior',
  ]) {
    assert.match(markdown, new RegExp(heading));
  }
  assert.match(markdown, /shadow-only/i);
  assert.match(markdown, /Do not write to global Pi, Codex, Claude, or user skill folders/i);
  assert.match(markdown, /visual_false_negative/);
});
