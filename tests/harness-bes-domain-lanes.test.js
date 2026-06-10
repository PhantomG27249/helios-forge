import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runResearchPolicyBesLane } from '../src/harness-sidecar/meta/researchPolicyEvolution.js';
import { runLocalEvolutionLoop } from '../src/harness-sidecar/meta/localEvolutionLoop.js';
import { runLocalMetaHarness } from '../src/harness-sidecar/meta/localMetaHarness.js';
import { runSkillCandidateBesLane } from '../src/harness-sidecar/skills/skillEvolution.js';
import { runSwarmPolicyBesLane } from '../src/harness-sidecar/swarm/evolutionSwarmPlanner.js';

test('wraps generated skill candidates in BES lane evidence without installing them', async () => {
  const result = await runSkillCandidateBesLane({
    taskId: 'task-skill',
    skillNeed: {
      needId: 'debug_visual_regression',
      title: 'Debug Visual Regression',
      failureModes: ['visual_false_negative'],
      evidence: [{ eventId: 'rho-case-1', traceId: 'trace-1' }],
    },
    count: 1,
    now: () => new Date('2026-06-09T12:00:00.000Z'),
  });

  const candidate = result.candidates[0];
  assert.equal(result.lane, 'skill');
  assert.equal(candidate.target, 'skill_candidate');
  assert.equal(candidate.applied, false);
  assert.equal(candidate.promotion.allowed, false);
  assert.ok(candidate.evidence.sources.includes('domain_eval'));
});

test('wraps swarm attempt plans in BES lane evidence', async () => {
  const result = await runSwarmPolicyBesLane({
    taskId: 'task-swarm',
    evolutionArchive: [
      {
        candidateId: 'archive-candidate-1',
        strategy: 'visual-specialist-pass',
        score: 0.8,
        islandId: 'island-a',
        evidence: ['handoff contract', 'role coverage'],
      },
    ],
    hardCases: [{ caseId: 'case-swarm', reasons: ['missing_verifier_evidence'] }],
    maxCandidates: 1,
  });

  const candidate = result.candidates[0];
  assert.equal(result.lane, 'swarm');
  assert.equal(candidate.status, 'pending');
  assert.equal(candidate.promotion.allowed, false);
  assert.equal(candidate.planning.strategy, 'evolution_archive');
  assert.ok(candidate.evidence.sources.includes('domain_eval'));
});

test('research policy lane carries source-grounded domain evidence', async () => {
  const result = await runResearchPolicyBesLane({
    coreset: { items: [{ caseId: 'case-research', reason: 'unsupported_claim', supportedClaims: 4, unsupportedClaims: 1 }] },
  });

  assert.equal(result.lane, 'research');
  assert.equal(result.candidates[0].status, 'shadow_only');
  assert.equal(result.candidates[0].promotion.allowed, false);
  assert.ok(result.candidates[0].evidence.domain.reasons.includes('source_grounded_evidence_rewarded'));
});

test('local evolution and local meta preserve BES lane evidence without approval', async () => {
  const besLane = { lane: 'swarm', candidateCount: 1, candidates: [{ candidateId: 'attempt-1' }] };
  const loop = runLocalEvolutionLoop({
    cellId: 'cell-visual',
    besLane,
    attempt: {
      attemptId: 'attempt-1',
      evolutionOutput: {
        hardCaseTags: ['visual_false_negative'],
        suggestedProfileChange: { role: 'visual-specialist' },
      },
    },
  });

  assert.equal(loop.candidates[0].besLane.lane, 'swarm');
  assert.equal(loop.candidates[0].durableApplyApproved, false);

  const meta = await runLocalMetaHarness({
    archive: false,
    cell: { cellId: 'cell-visual' },
    besLane,
    attempt: {
      attemptId: 'attempt-1',
      evolutionOutput: {
        hardCaseTags: ['visual_false_negative'],
        suggestedProfileChange: { role: 'visual-specialist' },
      },
    },
  });

  assert.equal(meta.candidates[0].besLane.lane, 'swarm');
  assert.equal(meta.candidates[0].durableApplyApproved, false);
});
