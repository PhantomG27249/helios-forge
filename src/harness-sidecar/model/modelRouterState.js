const STRING_LIMIT = 160;
const EVIDENCE_LIMIT = 25;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value, limit = STRING_LIMIT) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, limit);
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp01(value) {
  const numeric = finiteNumber(value);
  if (numeric === null) return 0;
  return Math.min(1, Math.max(0, numeric));
}

function nonNegativeNumber(value) {
  const numeric = finiteNumber(value);
  if (numeric === null) return null;
  return Math.max(0, numeric);
}

function createEmptyArm(armId, priorAlpha, priorBeta) {
  return {
    armId,
    alpha: priorAlpha,
    beta: priorBeta,
    successes: 0,
    failures: 0,
    observations: 0,
    evidence: [],
  };
}

function cloneArm(arm) {
  return {
    armId: arm.armId,
    alpha: arm.alpha,
    beta: arm.beta,
    successes: arm.successes,
    failures: arm.failures,
    observations: arm.observations,
    evidence: arm.evidence.map((entry) => {
      const cloned = { ...entry };
      if (entry.failureModes) cloned.failureModes = [...entry.failureModes];
      return cloned;
    }),
  };
}

function normalizeArm(rawArm, armId, priorAlpha, priorBeta) {
  const safeArmId = boundedString(rawArm?.armId ?? armId);
  if (!safeArmId) return null;
  const successes = nonNegativeNumber(rawArm?.successes) ?? 0;
  const failures = nonNegativeNumber(rawArm?.failures) ?? 0;
  const observations = Math.max(0, Math.floor(nonNegativeNumber(rawArm?.observations) ?? Math.round(successes + failures)));
  const evidence = Array.isArray(rawArm?.evidence)
    ? rawArm.evidence.map((entry) => sanitizeRouterEvidence(entry)).filter((entry) => Object.keys(entry).length > 0).slice(-EVIDENCE_LIMIT)
    : [];
  return {
    armId: safeArmId,
    alpha: priorAlpha + successes,
    beta: priorBeta + failures,
    successes,
    failures,
    observations,
    evidence,
  };
}

export function modelRouterKey({ role, taskType, nodeKind, capabilityTags } = {}) {
  const parts = [
    `role:${boundedString(role) || 'unknown'}`,
    `task:${boundedString(taskType) || 'unknown'}`,
  ];
  const safeNodeKind = boundedString(nodeKind);
  if (safeNodeKind) parts.push(`node:${safeNodeKind}`);
  const tags = Array.isArray(capabilityTags)
    ? [...new Set(capabilityTags.map((tag) => boundedString(tag, 64)).filter(Boolean))].sort()
    : [];
  if (tags.length > 0) parts.push(`cap:${tags.join(',')}`);
  return parts.join('|');
}

export function sanitizeRouterEvidence(evidence = {}) {
  if (!isPlainObject(evidence)) return {};
  const sanitized = {};

  for (const field of ['taskId', 'attemptId', 'role', 'modelProfile', 'endpointProfile']) {
    const value = boundedString(evidence[field]);
    if (value) sanitized[field] = value;
  }

  if (typeof evidence.verifierPassed === 'boolean') sanitized.verifierPassed = evidence.verifierPassed;
  if (typeof evidence.safetyBlocked === 'boolean') sanitized.safetyBlocked = evidence.safetyBlocked;

  if (evidence.score !== undefined) sanitized.score = clamp01(evidence.score);
  const latencyMs = nonNegativeNumber(evidence.latencyMs);
  if (latencyMs !== null) sanitized.latencyMs = latencyMs;
  const costEstimate = nonNegativeNumber(evidence.costEstimate);
  if (costEstimate !== null) sanitized.costEstimate = costEstimate;

  if (Array.isArray(evidence.failureModes)) {
    const failureModes = evidence.failureModes
      .map((mode) => boundedString(mode, 96))
      .filter(Boolean)
      .slice(0, 12);
    if (failureModes.length > 0) sanitized.failureModes = failureModes;
  }

  return sanitized;
}

export function createModelRouterState(options = {}) {
  const { initialState } = options;
  const safePriorAlpha = Math.max(0.000001, finiteNumber(options.priorAlpha ?? initialState?.priorAlpha) ?? 1);
  const safePriorBeta = Math.max(0.000001, finiteNumber(options.priorBeta ?? initialState?.priorBeta) ?? 1);
  let keys = {};

  function ensureKey(key) {
    const safeKey = boundedString(key, 512) || modelRouterKey();
    if (!keys[safeKey]) keys[safeKey] = { arms: {} };
    return { safeKey, entry: keys[safeKey] };
  }

  function ensureArm({ key, armId }) {
    const safeArmId = boundedString(armId);
    if (!safeArmId) return null;
    const { entry } = ensureKey(key);
    if (!entry.arms[safeArmId]) {
      entry.arms[safeArmId] = createEmptyArm(safeArmId, safePriorAlpha, safePriorBeta);
    }
    return entry.arms[safeArmId];
  }

  function restore(snapshot = {}) {
    const sourceKeys = isPlainObject(snapshot?.keys) ? snapshot.keys : {};
    const restored = {};
    for (const [rawKey, value] of Object.entries(sourceKeys)) {
      const safeKey = boundedString(rawKey, 512);
      if (!safeKey || !isPlainObject(value?.arms)) continue;
      restored[safeKey] = { arms: {} };
      for (const [rawArmId, rawArm] of Object.entries(value.arms)) {
        const arm = normalizeArm(rawArm, rawArmId, safePriorAlpha, safePriorBeta);
        if (arm) restored[safeKey].arms[arm.armId] = arm;
      }
    }
    keys = restored;
  }

  if (initialState) restore(initialState);

  return {
    getArm({ key, armId } = {}) {
      const safeArmId = boundedString(armId);
      if (!safeArmId) return null;
      const safeKey = boundedString(key, 512) || modelRouterKey();
      const arm = keys[safeKey]?.arms?.[safeArmId] || createEmptyArm(safeArmId, safePriorAlpha, safePriorBeta);
      return cloneArm(arm);
    },

    listArms({ key } = {}) {
      const safeKey = boundedString(key, 512) || modelRouterKey();
      return Object.values(keys[safeKey]?.arms || {}).map(cloneArm);
    },

    recordReward({ key, armId, reward, evidence } = {}) {
      const arm = ensureArm({ key, armId });
      if (!arm) return null;
      const boundedReward = clamp01(reward);
      arm.successes = Number((arm.successes + boundedReward).toFixed(6));
      arm.failures = Number((arm.failures + (1 - boundedReward)).toFixed(6));
      arm.alpha = Number((safePriorAlpha + arm.successes).toFixed(6));
      arm.beta = Number((safePriorBeta + arm.failures).toFixed(6));
      arm.observations += 1;

      const safeEvidence = sanitizeRouterEvidence(evidence);
      if (Object.keys(safeEvidence).length > 0) {
        arm.evidence.push(safeEvidence);
        if (arm.evidence.length > EVIDENCE_LIMIT) {
          arm.evidence.splice(0, arm.evidence.length - EVIDENCE_LIMIT);
        }
      }

      return cloneArm(arm);
    },

    snapshot() {
      const serializedKeys = {};
      for (const [key, entry] of Object.entries(keys)) {
        serializedKeys[key] = { arms: {} };
        for (const [armId, arm] of Object.entries(entry.arms || {})) {
          serializedKeys[key].arms[armId] = cloneArm(arm);
        }
      }
      return {
        version: 1,
        priorAlpha: safePriorAlpha,
        priorBeta: safePriorBeta,
        keys: serializedKeys,
      };
    },

    restore,
  };
}
