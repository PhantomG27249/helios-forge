import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildModelDebateEvidence,
  buildModelDebatePrompt,
} from '../src/harness-sidecar/swarm/modelCouncil.js';

test('builds bounded debate prompts for evidence-only critique', () => {
  const prompt = buildModelDebatePrompt({
    debateId: 'debate-42',
    task: {
      taskId: 'task-42',
      goal: 'Choose the safest patch for verifier selection.',
      constraints: ['Do not touch public/app.js', 'Require external verifier evidence'],
    },
    participant: { id: 'critic', role: 'reviewer', modelProfile: 'critic_model' },
    claims: [
      { claimId: 'claim-1', participantId: 'implementer', text: 'Patch A updates the selector.', confidence: 1.7 },
    ],
  });

  assert.equal(prompt.debateId, 'debate-42');
  assert.equal(prompt.taskId, 'task-42');
  assert.equal(prompt.participant.id, 'critic');
  assert.equal(prompt.evidenceOnly, true);
  assert.equal(prompt.canPromote, false);
  assert.equal(prompt.approved, false);
  assert.equal(prompt.apply, false);
  assert.equal(prompt.verified, false);
  assert.equal(prompt.verifierBypass, false);
  assert.equal(prompt.canBypassVerifier, false);
  assert.match(prompt.messages[0].content, /evidence-only model debate/i);
  assert.match(prompt.messages[1].content, /Choose the safest patch/);
  assert.match(prompt.messages[1].content, /Patch A updates the selector/);
  assert.match(prompt.messages[1].content, /Return JSON/);
  assert.match(prompt.messages[1].content, /critiques/);
  assert.doesNotMatch(prompt.messages.map((message) => message.content).join('\n'), /can approve/i);
});

test('normalizes critique outputs, agreement, disagreement, confidence, and quarantine as evidence only', () => {
  const evidence = buildModelDebateEvidence({
    debateId: 'debate-42',
    taskId: 'task-42',
    participants: [
      { id: 'implementer', role: 'implementer', modelProfile: 'alpha' },
      { id: 'critic', role: 'reviewer', modelProfile: 'critic' },
      { id: 'risk', role: 'risk-auditor', modelProfile: 'risk' },
    ],
    outputs: [
      {
        participantId: 'implementer',
        claims: [
          { claimId: 'claim-a', text: 'Selector patch is safe.', confidence: 0.82 },
        ],
        critiques: [
          { targetClaimId: 'claim-b', verdict: 'disagree', summary: 'It weakens verifier coverage.', confidence: 0.77 },
        ],
        confidence: 1.42,
        approved: true,
      },
      {
        participantId: 'critic',
        claims: [
          { claimId: 'claim-b', text: 'Selector patch needs another verifier.', confidence: 0.61 },
        ],
        critiques: [
          { targetClaimId: 'claim-a', verdict: 'disagree', summary: 'External verifier evidence is missing.', confidence: 0.4 },
        ],
        confidence: 0.66,
        apply: true,
      },
      {
        participantId: 'risk',
        claims: [
          { claimId: 'claim-c', text: 'Both models agree quarantine is needed.', confidence: -4 },
        ],
        critiques: [
          { targetClaimId: 'claim-a', verdict: 'agree', summary: 'Quarantine until verifier passes.', confidence: 0.58 },
        ],
        confidence: 0.25,
        verified: true,
        verifierBypass: true,
        canPromote: true,
      },
    ],
  });

  assert.equal(evidence.debateId, 'debate-42');
  assert.equal(evidence.taskId, 'task-42');
  assert.equal(evidence.evidenceOnly, true);
  assert.equal(evidence.canPromote, false);
  assert.equal(evidence.approved, false);
  assert.equal(evidence.apply, false);
  assert.equal(evidence.verified, false);
  assert.equal(evidence.verifierBypass, false);
  assert.equal(evidence.canBypassVerifier, false);
  assert.equal(evidence.participants.length, 3);
  assert.equal(evidence.claims.length, 3);
  assert.equal(evidence.critiques.length, 3);
  assert.equal(evidence.claims.every((claim) => claim.evidenceOnly === true && claim.canPromote === false), true);
  assert.equal(evidence.critiques.every((critique) => critique.evidenceOnly === true && critique.verified === false), true);
  assert.deepEqual(evidence.agreement, {
    status: 'partial',
    agreedClaimIds: ['claim-a'],
    reason: 'at_least_one_agreement',
  });
  assert.equal(evidence.disagreement.status, 'present');
  assert.deepEqual(evidence.disagreement.claimIds, ['claim-a', 'claim-b']);
  assert.deepEqual(evidence.disagreement.reasons, ['explicit_critique_disagreement']);
  assert.equal(evidence.confidence.score, 0.636667);
  assert.equal(evidence.confidence.bounded, true);
  assert.equal(evidence.confidence.authority, 'debate_evidence_only');
  assert.equal(evidence.quarantine.required, true);
  assert.deepEqual(evidence.quarantine.reasons, [
    'unsafe_approval_claim',
    'unsafe_apply_claim',
    'unsafe_verified_claim',
    'unsafe_verifier_bypass_claim',
    'unsafe_promotion_claim',
  ]);
});

test('omits verifier bypass authority even when every participant claims approval', () => {
  const evidence = buildModelDebateEvidence({
    debateId: 'debate-approval',
    taskId: 'task-approval',
    participants: [{ id: 'approver', role: 'reviewer', modelProfile: 'critic' }],
    outputs: [{
      participantId: 'approver',
      claims: [{ text: 'I verified and approve this patch.', confidence: 0.9, verified: true }],
      critiques: [],
      confidence: 0.9,
      approved: true,
      canPromote: true,
      bypassVerifier: true,
    }],
  });

  assert.equal(evidence.evidenceOnly, true);
  assert.equal(evidence.approved, false);
  assert.equal(evidence.verified, false);
  assert.equal(evidence.canPromote, false);
  assert.equal(evidence.verifierBypass, false);
  assert.equal(evidence.canBypassVerifier, false);
  assert.equal(evidence.quarantine.required, true);
  assert.equal(evidence.quarantine.reasons.includes('unsafe_verifier_bypass_claim'), true);
  assert.equal(evidence.claims[0].approved, false);
  assert.equal(evidence.claims[0].verified, false);
});
