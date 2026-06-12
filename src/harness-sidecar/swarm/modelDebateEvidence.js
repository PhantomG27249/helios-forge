import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

const DEFAULT_CONFIDENCE = 0.5;

function boundedText(value, maxLength = 240) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maxLength);
}

function safeModelVisibleText(value, maxLength = 240, reasons = null) {
  const quarantined = quarantineModelVisiblePayload(boundedText(value, maxLength), { maxStringLength: maxLength });
  if (reasons && quarantined.quarantined) {
    for (const reason of quarantined.reasons) reasons.add(reason);
  }
  return quarantined.value;
}

function clamp01(value, fallback = DEFAULT_CONFIDENCE) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function roundMetric(value) {
  return Number(clamp01(value).toFixed(6));
}

function uniqueSorted(values = []) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function safetyFields() {
  return {
    evidenceOnly: true,
    canPromote: false,
    approved: false,
    apply: false,
    verified: false,
    verifierBypass: false,
    canBypassVerifier: false,
  };
}

function unsafeFieldReasons(records = []) {
  const has = (predicate) => records.some((record) => record && predicate(record));
  const reasons = [];
  if (has((record) => record.approved === true)) reasons.push('unsafe_approval_claim');
  if (has((record) => record.apply === true || record.applies === true)) reasons.push('unsafe_apply_claim');
  if (has((record) => record.verified === true)) reasons.push('unsafe_verified_claim');
  if (has((record) => (
    record.verifierBypass === true
    || record.bypassVerifier === true
    || record.canBypassVerifier === true
  ))) {
    reasons.push('unsafe_verifier_bypass_claim');
  }
  if (has((record) => record.canPromote === true)) reasons.push('unsafe_promotion_claim');
  return reasons;
}

function normalizeParticipant(participant = {}, index = 0) {
  const id = boundedText(participant.id || participant.participantId || `participant-${index + 1}`, 96);
  return {
    id,
    role: boundedText(participant.role || 'debater', 96) || 'debater',
    modelProfile: boundedText(participant.modelProfile || participant.profileName, 96) || null,
    ...safetyFields(),
  };
}

function normalizeClaim(claim = {}, { participantId, index, quarantineReasons = null } = {}) {
  const claimId = boundedText(claim.claimId || claim.id || `${participantId || 'participant'}-claim-${index + 1}`, 96);
  return {
    claimId,
    participantId: boundedText(claim.participantId || participantId, 96) || null,
    text: safeModelVisibleText(claim.text || claim.summary || claim.claim, 512, quarantineReasons),
    confidence: roundMetric(claim.confidence),
    ...safetyFields(),
  };
}

function normalizeCritique(critique = {}, { participantId, index, quarantineReasons = null } = {}) {
  const verdict = boundedText(critique.verdict || critique.status || 'concern', 48).toLowerCase();
  return {
    critiqueId: boundedText(critique.critiqueId || critique.id || `${participantId || 'participant'}-critique-${index + 1}`, 96),
    participantId: boundedText(critique.participantId || participantId, 96) || null,
    targetClaimId: boundedText(critique.targetClaimId || critique.claimId, 96) || null,
    verdict: ['agree', 'disagree', 'concern', 'uncertain'].includes(verdict) ? verdict : 'concern',
    summary: safeModelVisibleText(critique.summary || critique.text || critique.reason, 512, quarantineReasons),
    confidence: roundMetric(critique.confidence),
    ...safetyFields(),
  };
}

function agreementSummary(critiques = []) {
  const agreedClaimIds = uniqueSorted(
    critiques
      .filter((critique) => critique.verdict === 'agree')
      .map((critique) => critique.targetClaimId),
  );
  return {
    status: agreedClaimIds.length ? 'partial' : 'not_detected',
    agreedClaimIds,
    reason: agreedClaimIds.length ? 'at_least_one_agreement' : 'no_explicit_agreement',
  };
}

function disagreementSummary(critiques = []) {
  const claimIds = uniqueSorted(
    critiques
      .filter((critique) => critique.verdict === 'disagree')
      .map((critique) => critique.targetClaimId),
  );
  return {
    status: claimIds.length ? 'present' : 'not_detected',
    claimIds,
    reasons: claimIds.length ? ['explicit_critique_disagreement'] : [],
  };
}

function confidenceSummary({ outputs = [] } = {}) {
  const values = outputs
    .map((output) => clamp01(output?.confidence))
    .filter((value) => Number.isFinite(value));
  const score = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : DEFAULT_CONFIDENCE;
  return {
    score: roundMetric(score),
    bounded: true,
    authority: 'debate_evidence_only',
  };
}

export function buildModelDebatePrompt({
  debateId,
  task = {},
  participant = {},
  claims = [],
} = {}) {
  const normalizedParticipant = normalizeParticipant(participant);
  const taskId = boundedText(task.taskId || task.id, 96);
  const quarantineReasons = new Set();
  const goal = safeModelVisibleText(task.goal || task.task || task.prompt, 1024, quarantineReasons);
  const constraints = Array.isArray(task.constraints)
    ? task.constraints.map((constraint) => safeModelVisibleText(constraint, 240, quarantineReasons)).filter(Boolean)
    : [];
  const claimLines = claims.map((claim, index) => {
    const normalized = normalizeClaim(claim, { participantId: claim.participantId, index, quarantineReasons });
    return `- ${normalized.claimId}: ${normalized.text} (confidence ${normalized.confidence})`;
  });

  return {
    debateId: boundedText(debateId, 96),
    taskId,
    participant: normalizedParticipant,
    messages: [
      {
        role: 'system',
        content: [
          'You are participating in an evidence-only model debate.',
          'Critique claims, surface disagreement, and estimate bounded confidence.',
          'Do not approve, apply, verify, promote, or bypass external verifiers.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          `Task: ${goal || taskId || 'unspecified'}`,
          constraints.length ? `Constraints:\n- ${constraints.join('\n- ')}` : null,
          claimLines.length ? `Claims to critique:\n${claimLines.join('\n')}` : 'Claims to critique: none supplied.',
          'Return JSON with claims, critiques, agreement, disagreement, and confidence.',
        ].filter(Boolean).join('\n\n'),
      },
    ],
    expectedOutput: {
      requiredFields: ['claims', 'critiques', 'confidence'],
      evidenceOnly: true,
    },
    quarantine: {
      required: quarantineReasons.size > 0,
      reasons: [...quarantineReasons].sort(),
    },
    ...safetyFields(),
  };
}

export function buildModelDebateEvidence({
  debateId,
  taskId,
  participants = [],
  outputs = [],
} = {}) {
  const normalizedParticipants = participants.map(normalizeParticipant);
  const normalizedClaims = [];
  const normalizedCritiques = [];
  const quarantineReasons = new Set();

  for (const [outputIndex, output] of outputs.entries()) {
    const participantId = boundedText(output?.participantId || normalizedParticipants[outputIndex]?.id, 96);
    const outputClaims = Array.isArray(output?.claims) ? output.claims : [];
    const outputCritiques = Array.isArray(output?.critiques) ? output.critiques : [];
    outputClaims.forEach((claim, index) => {
      normalizedClaims.push(normalizeClaim(claim, { participantId, index, quarantineReasons }));
    });
    outputCritiques.forEach((critique, index) => {
      normalizedCritiques.push(normalizeCritique(critique, { participantId, index, quarantineReasons }));
    });
  }

  const rawNestedRecords = outputs.flatMap((output) => [
    output,
    ...(Array.isArray(output?.claims) ? output.claims : []),
    ...(Array.isArray(output?.critiques) ? output.critiques : []),
  ]);
  for (const reason of unsafeFieldReasons(rawNestedRecords)) quarantineReasons.add(reason);

  return {
    debateId: boundedText(debateId, 96),
    taskId: boundedText(taskId, 96),
    participants: normalizedParticipants,
    claims: normalizedClaims,
    critiques: normalizedCritiques,
    agreement: agreementSummary(normalizedCritiques),
    disagreement: disagreementSummary(normalizedCritiques),
    confidence: confidenceSummary({
      outputs,
    }),
    quarantine: {
      required: quarantineReasons.size > 0,
      reasons: [...quarantineReasons].sort(),
    },
    ...safetyFields(),
  };
}
