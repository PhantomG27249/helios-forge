const DEFAULT_LIMIT = 8;
const LOW_COMPLETION_THRESHOLD = 0.5;

function stableString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function getTaskId(trace, index) {
  return stableString(trace?.taskId ?? trace?.task_id ?? trace?.id ?? `trace_${index}`);
}

function getEvents(trace) {
  return Array.isArray(trace?.events) ? trace.events : [];
}

function hasRecoveryEvidence(trace) {
  const events = getEvents(trace);
  return Boolean(
    trace?.failed === true ||
      trace?.failure === true ||
      trace?.status === 'failed' ||
      trace?.status === 'failure' ||
      trace?.status === 'error' ||
      trace?.success === false ||
      (Array.isArray(trace?.recoveryEvents) && trace.recoveryEvents.length > 0) ||
      (Array.isArray(trace?.failures) && trace.failures.length > 0) ||
      events.some((event) => (
        stableString(event?.type).includes('failure') ||
        stableString(event?.type).includes('recovery') ||
        stableString(event?.status) === 'failed'
      ))
  );
}

function hasBudgetGate(trace) {
  const events = getEvents(trace);
  return Boolean(
    trace?.budgetGate === true ||
      (Array.isArray(trace?.budgetGates) && trace.budgetGates.length > 0) ||
      events.some((event) => stableString(event?.type) === 'budget.gate')
  );
}

function hasLowCompletionOrUnsuccessful(trace) {
  const completion = Number(trace?.subgoalCompletion ?? trace?.completion ?? trace?.completionRate);
  return Boolean(
    trace?.status === 'failed' ||
      trace?.status === 'unsuccessful' ||
      trace?.success === false ||
      (Number.isFinite(completion) && completion < LOW_COMPLETION_THRESHOLD)
  );
}

function hasMetaDecisionEvidence(trace) {
  const events = getEvents(trace);
  const decision = stableString(trace?.metaDecision ?? trace?.decision ?? trace?.promotionDecision);
  return Boolean(
    decision === 'rejected' ||
      decision === 'promoted' ||
      trace?.rejected === true ||
      trace?.promoted === true ||
      events.some((event) => {
        const type = stableString(event?.type);
        const eventDecision = stableString(event?.decision ?? event?.status);
        return (
          type.includes('meta') &&
          (eventDecision === 'rejected' || eventDecision === 'promoted')
        );
      })
  );
}

function eventTypeIncludes(trace, value) {
  return getEvents(trace).some((event) => stableString(event?.type).toLowerCase().includes(value));
}

function graphFailureTypes(trace) {
  return [
    trace?.memgraphFailure?.type,
    trace?.memgraph?.failureType,
    ...(
      Array.isArray(trace?.graphConstructionFailures)
        ? trace.graphConstructionFailures.map((failure) => failure?.type)
        : []
    ),
  ].map((value) => stableString(value).toLowerCase()).filter(Boolean);
}

function scoreMemGraphEvidence(trace) {
  const reasons = [];
  let score = 0;
  const failureTypes = graphFailureTypes(trace);

  if (failureTypes.includes('logical_conflict') || eventTypeIncludes(trace, 'memgraph.logical_conflict')) {
    score += 6;
    reasons.push('memgraph_logical_conflict');
  }
  if (failureTypes.includes('temporal_conflict') || eventTypeIncludes(trace, 'memgraph.temporal_conflict')) {
    score += 5;
    reasons.push('memgraph_temporal_conflict');
  }
  if (
    failureTypes.includes('granularity_conflict') ||
    trace?.memoryGraph?.granularityConflict === true ||
    eventTypeIncludes(trace, 'memgraph.granularity_conflict')
  ) {
    score += 4;
    reasons.push('memgraph_granularity_conflict');
  }
  if (
    failureTypes.includes('fragmentation') ||
    numberOrNull(trace?.memgraph?.fragmentationScore) >= 0.8 ||
    eventTypeIncludes(trace, 'memgraph.fragmentation')
  ) {
    score += 3;
    reasons.push('memgraph_fragmentation');
  }
  if (
    failureTypes.includes('pending_activation_stall') ||
    trace?.memgraph?.pendingActivationStall === true ||
    eventTypeIncludes(trace, 'memgraph.pending_activation_stall')
  ) {
    score += 2.5;
    reasons.push('memgraph_pending_activation_stall');
  }
  if (
    failureTypes.includes('thematic_irrelevance') ||
    trace?.memgraph?.thematicIrrelevance === true ||
    eventTypeIncludes(trace, 'memgraph.thematic_irrelevance')
  ) {
    score += 2;
    reasons.push('memgraph_thematic_irrelevance');
  }

  return { score, reasons };
}

function scoreSwarmEvidence(trace) {
  const reasons = [];
  let score = 0;
  const failureModes = Array.isArray(trace?.failureModes)
    ? trace.failureModes.map((mode) => stableString(mode))
    : [];

  const hasMode = (mode) => failureModes.includes(mode);
  if (hasMode('swarm_unsafe_patch')) {
    score += 5;
    reasons.push('swarm_unsafe_patch');
  }
  if (hasMode('swarm_missing_verifier_evidence')) {
    score += 4;
    reasons.push('swarm_missing_verifier_evidence');
  }
  if (hasMode('swarm_visual_failure')) {
    score += 4;
    reasons.push('swarm_visual_failure');
  }
  if (hasMode('swarm_champion_regression')) {
    score += 4;
    reasons.push('swarm_champion_regression');
  }
  if (hasMode('swarm_recombination_win')) {
    score += 2;
    reasons.push('swarm_recombination_win');
  }

  return { score, reasons };
}

function scoreTrace(trace) {
  const reasons = [];
  let score = 0;

  if (hasRecoveryEvidence(trace)) {
    score += 3;
    reasons.push('failure_or_recovery');
  }
  if (hasBudgetGate(trace)) {
    score += 2;
    reasons.push('budget_gate');
  }
  if (hasLowCompletionOrUnsuccessful(trace)) {
    score += 2;
    reasons.push('low_completion_or_unsuccessful');
  }
  if (hasMetaDecisionEvidence(trace)) {
    score += 1;
    reasons.push('meta_decision_evidence');
  }
  const memGraph = scoreMemGraphEvidence(trace);
  score += memGraph.score;
  reasons.push(...memGraph.reasons);
  const swarm = scoreSwarmEvidence(trace);
  score += swarm.score;
  reasons.push(...swarm.reasons);

  return { score, reasons };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringIncludesVisualSignal(value) {
  const text = stableString(value).toLowerCase();
  return text.includes('visual') || text.includes('vlm');
}

function arrayHasVisualSignal(value) {
  return Array.isArray(value) && value.some((item) => stringIncludesVisualSignal(item));
}

function hasVisualArtifacts(verifierCase) {
  if (Array.isArray(verifierCase?.visualArtifacts)) {
    return verifierCase.visualArtifacts.length > 0;
  }
  return verifierCase?.visualArtifacts !== undefined && verifierCase?.visualArtifacts !== null;
}

function hasVisualVerifierEvidence(verifierCase = {}) {
  return Boolean(
    verifierCase.kind === 'visual' ||
      verifierCase.visual === true ||
      hasVisualArtifacts(verifierCase) ||
      arrayHasVisualSignal(verifierCase.tags) ||
      arrayHasVisualSignal(verifierCase.result?.tags) ||
      stringIncludesVisualSignal(verifierCase.verifier) ||
      stringIncludesVisualSignal(verifierCase.tool) ||
      stringIncludesVisualSignal(verifierCase.toolName) ||
      stringIncludesVisualSignal(verifierCase.tool_name) ||
      stringIncludesVisualSignal(verifierCase.result?.verifier) ||
      stringIncludesVisualSignal(verifierCase.result?.tool),
  );
}

function classifyVerifierCase(verifierCase = {}) {
  const classification = stableString(
    verifierCase.classification
      ?? verifierCase.result?.classification
      ?? verifierCase.outcome
      ?? verifierCase.type,
  );
  const normalizedClassification = classification.toLowerCase();
  if (classification === 'falseNegative' || classification === 'false_negative') {
    return { score: 5, reason: 'verifier_false_negative' };
  }
  if (classification === 'falsePositive' || classification === 'false_positive') {
    return { score: 5, reason: 'verifier_false_positive' };
  }
  if (
    classification === 'ambiguousVisualScore' ||
    normalizedClassification === 'ambiguous_visual_score' ||
    normalizedClassification === 'ambiguousvisualscore'
  ) {
    return { score: 3, reason: 'verifier_ambiguous_visual_score' };
  }
  if (verifierCase.flaky === true || numberOrNull(verifierCase.flakiness) > 0) {
    return { score: 4, reason: 'verifier_flaky' };
  }

  const score = numberOrNull(verifierCase.score ?? verifierCase.visualScore ?? verifierCase.result?.score);
  const passThreshold = numberOrNull(
    verifierCase.thresholds?.pass
      ?? verifierCase.thresholds?.passThreshold
      ?? verifierCase.rubric?.passThreshold,
  );
  if (
    score !== null
    && passThreshold !== null
    && Math.abs(score - passThreshold) <= 0.05
    && hasVisualVerifierEvidence(verifierCase)
  ) {
    return { score: 3, reason: 'verifier_ambiguous_visual_score' };
  }

  const cost = numberOrNull(verifierCase.cost ?? verifierCase.averageCost ?? verifierCase.result?.cost);
  const maxCost = numberOrNull(verifierCase.budget?.maxCost ?? verifierCase.maxCost);
  if (cost !== null && maxCost !== null && cost > maxCost) {
    return { score: 3, reason: 'verifier_high_cost' };
  }

  if (hasVisualVerifierEvidence(verifierCase)) {
    return { score: 2, reason: 'verifier_visual_evidence' };
  }

  return { score: 0, reason: null };
}

function getVerifierCaseId(verifierCase, index) {
  return stableString(verifierCase?.caseId ?? verifierCase?.id ?? verifierCase?.taskId ?? `verifier_case_${index}`);
}

function resolveVerifierDiversityKey(verifierCase, caseId, reason) {
  return stableString(reason ?? verifierCase?.verifier ?? verifierCase?.kind ?? caseId);
}

function rankedVerifierCase(verifierCase, index) {
  const caseId = getVerifierCaseId(verifierCase, index);
  const scored = classifyVerifierCase(verifierCase);
  return {
    id: caseId,
    taskId: caseId,
    caseId,
    score: scored.score,
    reasons: scored.reason ? [scored.reason] : [],
    verifierCase,
    source: 'verifier_case',
    diversityKey: resolveVerifierDiversityKey(verifierCase, caseId, scored.reason),
  };
}

function resolveDiversityKey(trace, taskId, diversityKey) {
  if (typeof diversityKey === 'function') {
    return stableString(diversityKey(trace));
  }
  if (typeof diversityKey === 'string' && diversityKey.length > 0) {
    const value = trace?.[diversityKey];
    if (Array.isArray(value)) {
      return stableString(value[0]);
    }
    return stableString(value);
  }
  const failureModes = trace?.failureModes ?? trace?.failure_modes;
  if (Array.isArray(failureModes) && failureModes.length > 0) {
    return stableString(failureModes[0]);
  }
  const firstRecovery = Array.isArray(trace?.recoveryEvents) ? trace.recoveryEvents[0] : undefined;
  return stableString(firstRecovery?.category ?? getEvents(trace)[0]?.category ?? taskId);
}

function compareRankedItems(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.diversityKey !== b.diversityKey) {
    return a.diversityKey.localeCompare(b.diversityKey);
  }
  return a.taskId.localeCompare(b.taskId);
}

export function buildRhoCoreset({
  traces = [],
  verifierCases = [],
  limit = DEFAULT_LIMIT,
  diversityKey,
} = {}) {
  const safeLimit = Math.max(0, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : DEFAULT_LIMIT);
  const rankedTraces = traces.map((trace, index) => {
    const taskId = getTaskId(trace, index);
    const scored = scoreTrace(trace);
    return {
      taskId,
      score: scored.score,
      reasons: scored.reasons,
      trace,
      diversityKey: resolveDiversityKey(trace, taskId, diversityKey),
    };
  });
  const rankedVerifierCases = verifierCases
    .map(rankedVerifierCase)
    .filter((item) => item.score > 0 || item.reasons.length > 0);
  const ranked = [...rankedTraces, ...rankedVerifierCases].sort(compareRankedItems);

  if (safeLimit === 0) {
    return { items: [], totalCandidates: ranked.length, selectedCount: 0 };
  }

  const selected = [];
  const selectedKeys = new Set();

  for (const item of ranked) {
    if (selected.length >= safeLimit) {
      break;
    }
    if (!selectedKeys.has(item.diversityKey)) {
      selected.push(item);
      selectedKeys.add(item.diversityKey);
    }
  }

  for (const item of ranked) {
    if (selected.length >= safeLimit) {
      break;
    }
    if (!selected.includes(item)) {
      selected.push(item);
    }
  }

  selected.sort(compareRankedItems);

  return {
    items: selected,
    totalCandidates: ranked.length,
    selectedCount: selected.length,
  };
}
