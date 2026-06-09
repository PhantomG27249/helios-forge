import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSkillEvolutionSearchContext,
  normalizeSkillEvolutionReward,
} from '../src/harness-sidecar/skills/skillEvolutionScheduler.js';

const skillNeed = {
  needId: 'skill_need_visual_debugging_repair',
  title: 'Visual Debugging Repair',
};

test('skill evolution scheduler goes wider when no candidate is strong', () => {
  const context = buildSkillEvolutionSearchContext({
    skillNeed,
    candidates: [{ candidateId: 'a' }, { candidateId: 'b' }],
    evaluations: [{ candidateId: 'a', totalScore: 0.32 }, { candidateId: 'b', totalScore: 0.41 }],
    budget: { remainingIterations: 4 },
  });

  const action = context.selectAction();
  assert.equal(action.type, 'go_wider');
  assert.equal(action.effect, 'create_more_skill_variants');
  assert.equal(context.traceEvents.at(-1).type, 'skill_evolution.ab_mcts_action_selected');
});

test('skill evolution scheduler goes deeper after partial success', () => {
  const context = buildSkillEvolutionSearchContext({
    skillNeed,
    candidates: [{ candidateId: 'best' }],
    evaluations: [{ candidateId: 'best', totalScore: 0.68, verifierEvidenceScore: 0.7 }],
    budget: { remainingIterations: 2 },
  });

  const action = context.selectAction();
  assert.equal(action.type, 'go_deeper');
  assert.equal(action.candidateId, 'best');
  assert.equal(context.traceEvents.at(-1).type, 'skill_evolution.candidate_refined');
});

test('skill evolution scheduler gathers evidence when reward is ambiguous', () => {
  const context = buildSkillEvolutionSearchContext({
    skillNeed,
    candidates: [{ candidateId: 'ambiguous' }],
    evaluations: [{ candidateId: 'ambiguous', totalScore: 0.74, replayCases: 1, confidence: 0.42 }],
    budget: { remainingIterations: 2 },
  });

  const action = context.selectAction();
  assert.equal(action.type, 'gather_evidence');
  assert.equal(action.effect, 'request_more_trace_replay_or_verifier_cases');
  assert.equal(context.traceEvents.at(-1).type, 'skill_evolution.evidence_requested');
});

test('skill evolution scheduler only recommends promotion and never installs directly', () => {
  const context = buildSkillEvolutionSearchContext({
    skillNeed,
    candidates: [{ candidateId: 'winner' }],
    evaluations: [{ candidateId: 'winner', totalScore: 0.91, confidence: 0.9, replayCases: 6 }],
    budget: { remainingIterations: 0 },
  });

  const action = context.selectAction();
  assert.equal(action.type, 'stop_or_promote');
  assert.equal(action.recommendation, 'promotion_review');
  assert.equal(action.install, false);
  assert.equal(action.candidateId, 'winner');
});

test('skill evolution rewards normalize deterministic evaluation dimensions', () => {
  const reward = normalizeSkillEvolutionReward({
    candidate: { candidateId: 'candidate' },
    evaluation: {
      baselineImprovement: 0.2,
      scaffoldAdherence: 0.8,
      triggerPrecision: 0.7,
      verifierEvidenceScore: 0.9,
      safetyScore: 1,
      promptInjectionHygiene: 0.75,
      costLatencyScore: 0.6,
    },
  });

  assert.equal(reward.candidateId, 'candidate');
  assert.equal(reward.score > 0.7, true);
  assert.equal(reward.components.safetyScore, 1);
});
