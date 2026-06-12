function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeText(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized || null;
}

function evidenceText(entry) {
  if (typeof entry === 'string') return entry.toLowerCase();
  return [
    entry?.id,
    entry?.goalId,
    entry?.subgoalId,
    entry?.command,
    entry?.summary,
    entry?.note,
    entry?.text,
  ].filter(Boolean).join(' ').toLowerCase();
}

function requirementText(subgoal = {}) {
  return asArray(subgoal.requiredEvidence ?? subgoal.requires ?? subgoal.requirement ?? subgoal.command ?? subgoal.id)
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
}

function subgoalId(subgoal, index) {
  return String(subgoal?.id ?? subgoal?.subgoalId ?? `subgoal_${index + 1}`);
}

function subgoalLanes(subgoal = {}) {
  return asArray(subgoal.lanes ?? subgoal.lane)
    .map(normalizeText)
    .filter(Boolean);
}

function appliesToLane(subgoal, lane) {
  const normalizedLane = normalizeText(lane);
  if (!normalizedLane) return true;
  const lanes = subgoalLanes(subgoal);
  return lanes.length === 0 || lanes.includes(normalizedLane);
}

function verifierForSubgoal(subgoal, fallback) {
  return normalizeText(subgoal?.verifierUnit ?? subgoal?.verifier ?? fallback) || 'dense_subgoal_eval';
}

function judgmentForSubgoal(modelJudgments, id) {
  return asArray(modelJudgments).find((judgment) => (
    String(judgment?.subgoalId ?? judgment?.id ?? '') === id
  ));
}

function normalizeModelJudgment(judgment = {}) {
  if (!judgment || typeof judgment !== 'object') return null;
  return {
    subgoalId: String(judgment.subgoalId ?? judgment.id ?? ''),
    status: judgment.satisfied === true ? 'satisfied' : (judgment.status || 'missing'),
    satisfied: judgment.satisfied === true,
    confidence: Number.isFinite(Number(judgment.confidence)) ? Number(judgment.confidence) : 0,
    evidenceOnly: true,
    promotionAuthority: false,
    canPromote: false,
  };
}

function satisfiesSubgoal(subgoal, evidence) {
  const requirements = requirementText(subgoal);
  if (requirements.length === 0) return false;
  const haystack = evidence.map(evidenceText);
  return requirements.every((requirement) => haystack.some((entry) => entry.includes(requirement)));
}

export function verifyDenseSubgoals({
  subgoals = [],
  evidence = [],
  lane,
  verifierUnit,
  verifierContract,
  modelJudgments = [],
} = {}) {
  const normalizedLane = normalizeText(lane);
  const defaultVerifierUnit = normalizeText(verifierUnit) || 'dense_subgoal_eval';
  const contract = verifierContract && typeof verifierContract === 'object'
    ? {
      ...verifierContract,
      lane: normalizeText(verifierContract.lane ?? normalizedLane),
      verifierUnit: normalizeText(verifierContract.verifierUnit ?? defaultVerifierUnit) || defaultVerifierUnit,
    }
    : {
      lane: normalizedLane,
      verifierUnit: defaultVerifierUnit,
      feedbackUnit: `${defaultVerifierUnit}_dense_feedback`,
      contractKind: 'lane_dense_subgoal_verifier',
      evidenceOnly: true,
      promotionAuthority: false,
    };
  const normalizedSubgoals = asArray(subgoals).filter((subgoal) => appliesToLane(subgoal, normalizedLane));
  const normalizedEvidence = asArray(evidence);
  const satisfiedSubgoalIds = [];
  const missingSubgoalIds = [];
  const denseFeedback = [];
  const verifierBuckets = new Map();

  normalizedSubgoals.forEach((subgoal, index) => {
    const id = subgoalId(subgoal, index);
    const subgoalVerifierUnit = verifierForSubgoal(subgoal, defaultVerifierUnit);
    const modelJudgment = normalizeModelJudgment(judgmentForSubgoal(modelJudgments, id));
    const satisfied = satisfiesSubgoal(subgoal, normalizedEvidence) || modelJudgment?.satisfied === true;
    if (satisfied) {
      satisfiedSubgoalIds.push(id);
    } else {
      missingSubgoalIds.push(id);
    }
    denseFeedback.push({
      subgoalId: id,
      status: satisfied ? 'satisfied' : 'missing',
      requires: requirementText(subgoal),
      ...(normalizedLane ? { lane: normalizedLane } : {}),
      verifierUnit: subgoalVerifierUnit,
      ...(modelJudgment ? { modelAssisted: modelJudgment } : {}),
    });
    if (!verifierBuckets.has(subgoalVerifierUnit)) {
      verifierBuckets.set(subgoalVerifierUnit, {
        lane: normalizedLane,
        verifierUnit: subgoalVerifierUnit,
        subgoalIds: [],
        satisfiedSubgoalIds: [],
        missingSubgoalIds: [],
      });
    }
    const bucket = verifierBuckets.get(subgoalVerifierUnit);
    bucket.subgoalIds.push(id);
    if (satisfied) {
      bucket.satisfiedSubgoalIds.push(id);
    } else {
      bucket.missingSubgoalIds.push(id);
    }
  });

  const total = normalizedSubgoals.length;
  return {
    score: total > 0 ? satisfiedSubgoalIds.length / total : 0,
    satisfiedSubgoalIds,
    missingSubgoalIds,
    denseFeedback,
    total,
    ...(normalizedLane ? { lane: normalizedLane } : {}),
    verifierUnit: defaultVerifierUnit,
    contract,
    verifierUnits: [...verifierBuckets.values()].sort((left, right) => (
      left.verifierUnit.localeCompare(right.verifierUnit)
    )),
  };
}
