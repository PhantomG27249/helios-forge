const DEFAULT_LIMIT = 8;
const LOW_COMPLETION_THRESHOLD = 0.5;
const EMBEDDING_DIVERSITY_WEIGHT = 3;
const DEFAULT_FALLBACK_EMBEDDING_DIMENSIONS = 16;

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

function compactionFailureModes(trace) {
  const fromTrace = Array.isArray(trace?.failureModes)
    ? trace.failureModes
    : [];
  const fromReplay = Array.isArray(trace?.compactionReplay?.failureModes)
    ? trace.compactionReplay.failureModes
    : [];
  const fromEvents = getEvents(trace).flatMap((event) => (
    Array.isArray(event?.replay?.failureModes) ? event.replay.failureModes : []
  ));
  return [...fromTrace, ...fromReplay, ...fromEvents]
    .map((mode) => stableString(mode))
    .filter((mode) => mode.startsWith('compaction_'));
}

function hasCompactionEvent(trace, value) {
  return getEvents(trace).some((event) => stableString(event?.type).toLowerCase().includes(value));
}

function scoreCompactionEvidence(trace) {
  const reasons = [];
  let score = 0;
  const failureModes = compactionFailureModes(trace);
  const hasMode = (mode) => failureModes.includes(mode);

  if (
    hasMode('compaction_lost_constraints') ||
    hasMode('compaction_lost_constraint') ||
    Array.isArray(trace?.compaction?.lostConstraints) && trace.compaction.lostConstraints.length > 0 ||
    Array.isArray(trace?.compactionReplay?.lostConstraints) && trace.compactionReplay.lostConstraints.length > 0
  ) {
    score += 6;
    reasons.push(hasMode('compaction_lost_constraint') ? 'compaction_lost_constraint' : 'compaction_lost_constraints');
  }
  if (hasMode('compaction_lost_file')) {
    score += 5;
    reasons.push('compaction_lost_file');
  }
  if (hasMode('compaction_lost_test')) {
    score += 4;
    reasons.push('compaction_lost_test');
  }
  if (
    hasMode('compaction_hallucination') ||
    hasMode('compaction_hallucinated_decision') ||
    hasCompactionEvent(trace, 'compaction.hallucination')
  ) {
    score += 5;
    reasons.push(hasMode('compaction_hallucinated_decision') ? 'compaction_hallucinated_decision' : 'compaction_hallucination');
  }
  if (hasMode('compaction_continuation_failed') || trace?.compactionReplay?.continuationSucceeded === false) {
    score += 4;
    reasons.push('compaction_continuation_failed');
  }
  if (hasMode('compaction_bad_trigger')) {
    score += 4;
    reasons.push('compaction_bad_trigger');
  }
  if (
    hasMode('compaction_token_bloat') ||
    (
      numberOrNull(trace?.compaction?.tokenReduction) !== null &&
      numberOrNull(trace?.compaction?.tokenReduction) < 0.1
    )
  ) {
    score += 2;
    reasons.push('compaction_token_bloat');
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
  const compaction = scoreCompactionEvidence(trace);
  score += compaction.score;
  reasons.push(...compaction.reasons);

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

function rankedVerifierCase(verifierCase, index, {
  embeddingIndex,
  fallbackEmbeddingDimensions = 0,
} = {}) {
  const caseId = getVerifierCaseId(verifierCase, index);
  const scored = classifyVerifierCase(verifierCase);
  const diversityKey = resolveVerifierDiversityKey(verifierCase, caseId, scored.reason);
  const embeddingEvidence = resolveEmbeddingEvidence(verifierCase, {
    id: caseId,
    embeddingIndex,
    fallbackEmbeddingDimensions,
  });
  return {
    id: caseId,
    taskId: caseId,
    caseId,
    score: scored.score,
    reasons: scored.reason ? [scored.reason] : [],
    verifierCase,
    source: 'verifier_case',
    diversityKey,
    embedding: embeddingEvidence.embedding,
    embeddingSource: embeddingEvidence.source,
    metadata: {
      difficulty: {
        score: scored.score,
        band: difficultyBand(scored.score),
        reasons: scored.reason ? [scored.reason] : [],
      },
      diversity: {
        key: diversityKey,
        keys: [diversityKey],
        source: 'verifier_case',
        embeddingAvailable: Boolean(embeddingEvidence.embedding),
        embeddingDimension: embeddingEvidence.embedding?.length ?? 0,
        embeddingSource: embeddingEvidence.source,
      },
    },
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

function resolveDiversityKeys(trace, taskId, diversityKey) {
  const failureModes = trace?.failureModes ?? trace?.failure_modes;
  if (Array.isArray(failureModes) && failureModes.length > 0) {
    return failureModes.map(stableString).filter(Boolean);
  }
  const key = resolveDiversityKey(trace, taskId, diversityKey);
  return key ? [key] : [];
}

function difficultyBand(score) {
  if (score >= 5) return 'hard';
  if (score >= 2) return 'medium';
  return 'easy';
}

function normalizeHeldoutVariant(variant, index) {
  if (variant && typeof variant === 'object' && !Array.isArray(variant)) {
    return {
      variantId: stableString(variant.variantId ?? variant.id ?? variant.name ?? `variant_${index + 1}`),
      ...variant,
    };
  }
  return {
    variantId: stableString(variant ?? `variant_${index + 1}`),
  };
}

function heldoutVariants(trace) {
  const variants = Array.isArray(trace?.heldoutVariants)
    ? trace.heldoutVariants
    : (Array.isArray(trace?.heldout_variants) ? trace.heldout_variants : []);
  return variants.map(normalizeHeldoutVariant);
}

function traceLineage(trace = {}) {
  return {
    source: trace.source ?? trace.sourceRef ?? trace.source_ref ?? {},
    config: trace.config ?? trace.configRef ?? trace.config_ref ?? {},
    trace: trace.trace ?? trace.traceRef ?? trace.trace_ref ?? {},
  };
}

function replayMetadata({ trace, taskId, scored, diversityKey, source = 'trace' }) {
  const embedding = resolveEmbedding(trace);
  return {
    difficulty: {
      score: scored.score,
      band: difficultyBand(scored.score),
      reasons: scored.reasons,
    },
    diversity: {
      key: diversityKey,
      keys: resolveDiversityKeys(trace, taskId, diversityKey),
      source,
      embeddingAvailable: Boolean(embedding),
      embeddingDimension: embedding?.length ?? 0,
      embeddingSource: embedding ? 'inline' : 'none',
    },
  };
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

function normalizeEmbedding(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const vector = value.map((entry) => Number(entry));
  if (!vector.every(Number.isFinite)) {
    return null;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, entry) => sum + entry * entry, 0));
  return magnitude > 0 ? vector : null;
}

function resolveEmbedding(source = {}) {
  return normalizeEmbedding(
    source.embedding ??
      source.embeddingVector ??
      source.embedding_vector ??
      source.vector ??
      source.metadata?.embedding ??
      source.result?.embedding,
  );
}

function embeddingFromIndex(embeddingIndex, keys) {
  if (!embeddingIndex) {
    return null;
  }
  for (const key of keys.map(stableString).filter(Boolean)) {
    if (embeddingIndex instanceof Map && embeddingIndex.has(key)) {
      return normalizeEmbedding(embeddingIndex.get(key));
    }
    if (typeof embeddingIndex === 'function') {
      const embedding = normalizeEmbedding(embeddingIndex(key));
      if (embedding) {
        return embedding;
      }
    }
    if (Object.prototype.hasOwnProperty.call(Object(embeddingIndex), key)) {
      return normalizeEmbedding(embeddingIndex[key]);
    }
  }
  return null;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fallbackEmbeddingText(source = {}, id = '') {
  const fields = [
    id,
    source.prompt,
    source.summary,
    source.description,
    source.kind,
    source.verifier,
    source.toolName,
    source.tool_name,
    source.status,
    ...(Array.isArray(source.failureModes) ? source.failureModes : []),
    ...(Array.isArray(source.tags) ? source.tags : []),
    ...(Array.isArray(source.reasons) ? source.reasons : []),
  ];
  return fields.map(stableString).filter(Boolean).join(' ');
}

function deterministicFallbackEmbedding(source, id, dimensions) {
  const safeDimensions = Math.max(0, Math.floor(Number(dimensions) || 0));
  const text = fallbackEmbeddingText(source, id);
  if (safeDimensions === 0 || text.length === 0) {
    return null;
  }
  const vector = Array.from({ length: safeDimensions }, () => 0);
  const tokens = text.toLowerCase().split(/[^a-z0-9_:-]+/).filter(Boolean);
  for (const token of tokens.length > 0 ? tokens : [text.toLowerCase()]) {
    const hash = hashString(token);
    const bucket = hash % safeDimensions;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[bucket] += sign;
  }
  return normalizeEmbedding(vector);
}

function resolveEmbeddingEvidence(source = {}, {
  id,
  embeddingIndex,
  fallbackEmbeddingDimensions = DEFAULT_FALLBACK_EMBEDDING_DIMENSIONS,
} = {}) {
  const inline = resolveEmbedding(source);
  if (inline) {
    return { embedding: inline, source: 'inline' };
  }
  const provided = embeddingFromIndex(embeddingIndex, [
    id,
    source.taskId,
    source.task_id,
    source.caseId,
    source.case_id,
    source.id,
  ]);
  if (provided) {
    return { embedding: provided, source: 'provided' };
  }
  const fallback = deterministicFallbackEmbedding(source, id, fallbackEmbeddingDimensions);
  if (fallback) {
    return { embedding: fallback, source: 'fallback' };
  }
  return { embedding: null, source: 'none' };
}

function withEmbeddingMetadata(metadata, embeddingEvidence) {
  return {
    ...metadata,
    diversity: {
      ...metadata.diversity,
      embeddingAvailable: Boolean(embeddingEvidence.embedding),
      embeddingDimension: embeddingEvidence.embedding?.length ?? 0,
      embeddingSource: embeddingEvidence.source,
    },
  };
}

function dotProduct(left, right) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

function magnitude(vector) {
  return Math.sqrt(vector.reduce((sum, entry) => sum + entry * entry, 0));
}

function cosineSimilarity(left, right) {
  const denominator = magnitude(left) * magnitude(right);
  if (denominator === 0) {
    return 0;
  }
  return Math.max(-1, Math.min(1, dotProduct(left, right) / denominator));
}

function embeddingNovelty(item, selected) {
  if (!item.embedding || selected.length === 0) {
    return item.embedding ? 1 : 0;
  }
  const distances = selected
    .filter((selectedItem) => selectedItem.embedding)
    .map((selectedItem) => 1 - cosineSimilarity(item.embedding, selectedItem.embedding));
  return distances.length > 0 ? Math.min(...distances) : 1;
}

function compareEmbeddingCandidates(a, b) {
  if (b.selectionScore !== a.selectionScore) {
    return b.selectionScore - a.selectionScore;
  }
  if (b.novelty !== a.novelty) {
    return b.novelty - a.novelty;
  }
  return compareRankedItems(a.item, b.item);
}

function selectByEmbeddingDiversity(ranked, safeLimit) {
  const selected = [];
  const remaining = [...ranked];

  while (selected.length < safeLimit && remaining.length > 0) {
    const scored = remaining
      .map((item) => {
        const novelty = embeddingNovelty(item, selected);
        return {
          item,
          novelty,
          selectionScore: item.score + novelty * EMBEDDING_DIVERSITY_WEIGHT,
        };
      })
      .sort(compareEmbeddingCandidates);
    const next = scored[0].item;
    selected.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }

  return selected;
}

function selectByKeyDiversity(ranked, safeLimit) {
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

  return selected;
}

export function buildRhoCoreset({
  traces = [],
  verifierCases = [],
  limit = DEFAULT_LIMIT,
  diversityKey,
  embeddingIndex,
  embeddingById,
  precomputedEmbeddings,
  fallbackEmbeddingDimensions,
} = {}) {
  const safeLimit = Math.max(0, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : DEFAULT_LIMIT);
  const resolvedEmbeddingIndex = embeddingIndex ?? embeddingById ?? precomputedEmbeddings;
  const resolvedFallbackEmbeddingDimensions = fallbackEmbeddingDimensions ??
    (resolvedEmbeddingIndex ? DEFAULT_FALLBACK_EMBEDDING_DIMENSIONS : 0);
  const rankedTraces = traces.map((trace, index) => {
    const taskId = getTaskId(trace, index);
    const scored = scoreTrace(trace);
    const resolvedDiversityKey = resolveDiversityKey(trace, taskId, diversityKey);
    const embeddingEvidence = resolveEmbeddingEvidence(trace, {
      id: taskId,
      embeddingIndex: resolvedEmbeddingIndex,
      fallbackEmbeddingDimensions: resolvedFallbackEmbeddingDimensions,
    });
    return {
      taskId,
      score: scored.score,
      reasons: scored.reasons,
      trace,
      diversityKey: resolvedDiversityKey,
      embedding: embeddingEvidence.embedding,
      embeddingSource: embeddingEvidence.source,
      heldoutVariants: heldoutVariants(trace),
      lineage: traceLineage(trace),
      metadata: withEmbeddingMetadata(
        replayMetadata({
          trace,
          taskId,
          scored,
          diversityKey: resolvedDiversityKey,
        }),
        embeddingEvidence,
      ),
    };
  });
  const rankedVerifierCases = verifierCases
    .map((verifierCase, index) => rankedVerifierCase(verifierCase, index, {
      embeddingIndex: resolvedEmbeddingIndex,
      fallbackEmbeddingDimensions: resolvedFallbackEmbeddingDimensions,
    }))
    .filter((item) => item.score > 0 || item.reasons.length > 0);
  const ranked = [...rankedTraces, ...rankedVerifierCases].sort(compareRankedItems);

  if (safeLimit === 0) {
    return { items: [], totalCandidates: ranked.length, selectedCount: 0 };
  }

  const embeddedCount = ranked.filter((item) => item.embedding).length;
  const fallbackEmbeddedCount = ranked.filter((item) => item.embeddingSource === 'fallback').length;
  const providedEmbeddedCount = ranked.filter((item) => item.embeddingSource === 'provided').length;
  const useEmbeddingDiversity = embeddedCount >= 2 && safeLimit >= 2;
  const selected = useEmbeddingDiversity
    ? selectByEmbeddingDiversity(ranked, safeLimit)
    : selectByKeyDiversity(ranked, safeLimit);

  selected.sort(compareRankedItems);

  return {
    items: selected,
    totalCandidates: ranked.length,
    selectedCount: selected.length,
    selection: {
      strategy: useEmbeddingDiversity ? 'embedding_dpp_like' : 'difficulty_diversity_key',
      embeddedCandidates: embeddedCount,
      providedEmbeddedCandidates: providedEmbeddedCount,
      fallbackEmbeddedCandidates: fallbackEmbeddedCount,
    },
  };
}
