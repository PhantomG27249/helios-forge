const ROUTER_FAILURE_SCORES = Object.freeze({
  model_router_safety_regression: 9,
  model_router_best_single_regression: 8,
  model_router_wrong_model: 7,
  model_router_council_disagreement_missed: 6,
  model_router_latency_regression: 5,
  model_router_under_explored_arm: 4,
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function taskIdFor(trace = {}, index = 0) {
  return stableString(trace.taskId ?? trace.task_id ?? trace.caseId ?? trace.id ?? `router_case_${index}`);
}

function selectedModelFor(trace = {}) {
  return stableString(
    trace.selectedModel ??
      trace.modelRouter?.selectedModel ??
      trace.modelRouter?.armId ??
      trace.modelRouter?.modelProfile ??
      trace.attempt?.modelProfile,
  );
}

function bestModelFor(trace = {}) {
  return stableString(
    trace.bestModel ??
      trace.bestSingle?.model ??
      trace.bestSingle?.modelProfile ??
      trace.staticCouncil?.championModel,
  );
}

function roleFor(trace = {}) {
  return stableString(trace.role ?? trace.modelRouter?.role ?? trace.attempt?.role ?? 'unknown');
}

function scoreGap(trace = {}) {
  const selectedScore = numberOrNull(trace.modelRouter?.score ?? trace.selectedScore ?? trace.attempt?.score);
  const bestScore = numberOrNull(trace.bestSingle?.score ?? trace.bestScore ?? trace.staticCouncil?.score);
  if (selectedScore === null || bestScore === null) return null;
  return bestScore - selectedScore;
}

function latencyRegression(trace = {}) {
  const selectedLatency = numberOrNull(trace.modelRouter?.latencyMs ?? trace.latencyMs);
  const bestLatency = numberOrNull(trace.bestSingle?.latencyMs ?? trace.baseline?.latencyMs);
  const selectedCost = numberOrNull(trace.modelRouter?.costEstimate ?? trace.costEstimate);
  const bestCost = numberOrNull(trace.bestSingle?.costEstimate ?? trace.baseline?.costEstimate);
  const qualityGap = Math.abs(scoreGap(trace) ?? 0);

  return Boolean(
    qualityGap <= 0.05 &&
      (
        (selectedLatency !== null && bestLatency !== null && selectedLatency > bestLatency * 2) ||
        (selectedCost !== null && bestCost !== null && selectedCost > bestCost * 2)
      )
  );
}

function hasUnderExploredArm(trace = {}) {
  const alternatives = asArray(trace.modelRouter?.alternatives ?? trace.routerAlternatives);
  return alternatives.some((arm) => {
    const observations = numberOrNull(arm.observations ?? arm.posterior?.observations);
    const sampledValue = numberOrNull(arm.sampledValue ?? arm.score);
    return observations !== null && observations < 2 && sampledValue !== null && sampledValue >= 0.6;
  });
}

function pushMode(failureModes, mode) {
  if (!failureModes.includes(mode)) {
    failureModes.push(mode);
  }
}

export function classifyModelRouterFailure(trace = {}) {
  const failureModes = [];
  const reasons = [];
  const selectedModel = selectedModelFor(trace);
  const bestModel = bestModelFor(trace);
  const gap = scoreGap(trace);

  if (trace.modelRouter?.safetyBlocked === true || trace.safetyBlocked === true) {
    pushMode(failureModes, 'model_router_safety_regression');
    reasons.push('selected_model_safety_blocked');
  }

  if (
    trace.bestSingle?.solved === true &&
      selectedModel &&
      bestModel &&
      selectedModel !== bestModel &&
      (gap === null || gap >= 0.1)
  ) {
    pushMode(failureModes, 'model_router_best_single_regression');
    reasons.push('best_single_model_outperformed_router');
  }

  if (trace.staticCouncil?.solved === true && trace.modelRouter?.solved === false) {
    pushMode(failureModes, 'model_router_wrong_model');
    reasons.push('static_council_beat_adaptive_router');
  }

  if (trace.review?.caughtFailure === true || trace.reviewer?.caughtFailure === true) {
    pushMode(failureModes, 'model_router_wrong_model');
    reasons.push('reviewer_caught_implementer_model_failure');
  }

  if (
    clamp01(trace.council?.disagreement?.level ?? trace.council?.disagreementScore) >= 0.75 &&
      (trace.council?.championCorrect === false || trace.council?.wrongChampion === true)
  ) {
    pushMode(failureModes, 'model_router_council_disagreement_missed');
    reasons.push('high_disagreement_wrong_champion');
  }

  if (latencyRegression(trace)) {
    pushMode(failureModes, 'model_router_latency_regression');
    reasons.push('equal_quality_higher_latency_or_cost');
  }

  if (hasUnderExploredArm(trace)) {
    pushMode(failureModes, 'model_router_under_explored_arm');
    reasons.push('promising_arm_under_explored');
  }

  const score = failureModes.reduce(
    (total, mode) => total + (ROUTER_FAILURE_SCORES[mode] ?? 1),
    0,
  );

  return {
    taskId: taskIdFor(trace),
    role: roleFor(trace),
    taskType: stableString(trace.taskType ?? trace.modelRouter?.taskType ?? trace.task?.type ?? 'unknown'),
    selectedModel,
    bestModel,
    failureModes,
    reasons,
    score,
    target: 'model_routing_policy',
    evidence: {
      authority: 'evidence_only',
      canPromote: false,
      selectedModel,
      bestModel,
      scoreGap: gap,
      safetyBlocked: Boolean(trace.modelRouter?.safetyBlocked ?? trace.safetyBlocked),
    },
  };
}

function sanitizedHardCase(trace, index) {
  const classification = classifyModelRouterFailure(trace);
  if (classification.failureModes.length === 0) {
    return null;
  }
  const taskId = taskIdFor(trace, index);
  return {
    id: taskId,
    taskId,
    caseId: taskId,
    role: classification.role,
    taskType: classification.taskType,
    selectedModel: classification.selectedModel,
    bestModel: classification.bestModel,
    failureModes: classification.failureModes,
    reasons: classification.failureModes,
    routerReasons: classification.reasons,
    score: classification.score,
    target: 'model_routing_policy',
    diversityKey: classification.failureModes[0] ?? taskId,
    evidence: classification.evidence,
    metadata: {
      modelRouter: {
        failureModes: classification.failureModes,
        reasons: classification.reasons,
        selectedModel: classification.selectedModel,
        bestModel: classification.bestModel,
        authority: 'evidence_only',
        canPromote: false,
      },
    },
  };
}

function compareHardCases(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.diversityKey !== b.diversityKey) return a.diversityKey.localeCompare(b.diversityKey);
  return a.taskId.localeCompare(b.taskId);
}

export function selectModelRouterHardCases({ traces = [], maxCases = 8, diversityKey } = {}) {
  const limit = Math.max(0, Math.floor(Number(maxCases) || 0));
  if (limit === 0) return [];
  const ranked = traces
    .map((trace, index) => {
      const item = sanitizedHardCase(trace, index);
      if (!item) return null;
      const key = typeof diversityKey === 'function'
        ? stableString(diversityKey(trace))
        : stableString(trace?.[diversityKey] ?? item.diversityKey);
      return { ...item, diversityKey: key || item.diversityKey };
    })
    .filter(Boolean)
    .sort(compareHardCases);

  const selected = [];
  const seen = new Set();
  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (seen.has(item.diversityKey)) continue;
    selected.push(item);
    seen.add(item.diversityKey);
  }
  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (!selected.includes(item)) selected.push(item);
  }
  return selected;
}

export function buildModelRouterCoreset({ traces = [], embeddings, maxCases = 8 } = {}) {
  const items = selectModelRouterHardCases({ traces, maxCases }).map((item) => {
    const embedding = embeddings?.[item.taskId] ?? embeddings?.[item.id] ?? null;
    return {
      ...item,
      embedding: Array.isArray(embedding) ? embedding : undefined,
      metadata: {
        ...item.metadata,
        diversity: {
          key: item.diversityKey,
          keys: item.failureModes,
          source: 'model_router_hard_case',
          embeddingAvailable: Array.isArray(embedding),
          embeddingDimension: Array.isArray(embedding) ? embedding.length : 0,
          embeddingSource: Array.isArray(embedding) ? 'provided' : 'none',
        },
      },
    };
  });

  return {
    items,
    totalCandidates: traces.length,
    selectedCount: items.length,
    target: 'model_routing_policy',
    evidence: {
      authority: 'evidence_only',
      canPromote: false,
    },
  };
}
