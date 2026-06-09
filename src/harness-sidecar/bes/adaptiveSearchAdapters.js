export function buildAdaptiveSearchContextForVerifier(input = {}) {
  const changedFiles = asArray(input.changedFiles);
  const verifierEvidence = asArray(input.verifierEvidence);
  const visualSurface = changedFiles.some((file) =>
    /^(public\/|public\\)|.*\.(html|css|png|jpg|jpeg|webp|svg)$|vlm|visual/i.test(file),
  );

  return {
    subsystem: 'verifier',
    taskId: input.taskId || input.task?.taskId || 'verifier_context',
    evidence: verifierEvidence.map((item) => ({
      kind: 'verifier',
      name: item.name,
      passed: Boolean(item.passed),
      confidence: clamp01(item.confidence ?? 0.5),
    })),
    evidenceCount: verifierEvidence.length,
    budget: normalizeBudget(input),
    signals: {
      visualSurface,
      recentFailureCount: asArray(input.recentFailures).length,
      heldOutAvailable: Boolean(input.heldOutAvailable || input.heldOutCases?.length),
      confidence: clamp01(input.confidence ?? average(verifierEvidence.map((item) => item.confidence), 0)),
    },
  };
}

export function normalizeAdaptiveSearchRewardForVerifier(output = {}) {
  const passScore = output.passed ? 0.58 : 0.12;
  const confidenceScore = clamp01(output.confidence ?? 0.5) * 0.27;
  const heldOutScore = output.heldOutPassed === true ? 0.1 : output.heldOutPassed === false ? -0.12 : 0;
  return finalizeReward(passScore + confidenceScore + heldOutScore, output);
}

export function buildAdaptiveSearchContextForVisual(input = {}) {
  const artifacts = asArray(input.artifacts);

  return {
    subsystem: 'visual',
    taskId: input.taskId || 'visual_context',
    evidence: artifacts.map((artifact) => ({
      kind: artifact.kind || artifact.type || 'artifact',
      quality: clamp01(artifact.quality ?? artifact.confidence ?? 0.5),
    })),
    evidenceCount: artifacts.length,
    budget: normalizeBudget(input),
    signals: {
      hasVisualEvidence: artifacts.length > 0,
      diffConfidence: clamp01(input.diffConfidence ?? 0),
      ocrConfidence: clamp01(input.ocrConfidence ?? 0),
      vlmConfidence: clamp01(input.vlmConfidence ?? 0),
    },
  };
}

export function normalizeAdaptiveSearchRewardForVisual(output = {}) {
  return finalizeReward(
    average([
      output.artifactQuality,
      output.diffConfidence,
      output.vlmConfidence,
      output.ocrConfidence,
    ], 0.5),
    output,
  );
}

export function buildAdaptiveSearchContextForResearch(input = {}) {
  const sources = asArray(input.sources);
  const contradictions = asArray(input.contradictions);

  return {
    subsystem: 'research',
    taskId: input.taskId || 'research_context',
    evidence: sources.map((source) => ({
      kind: 'source',
      id: source.id || source.url || source.title || 'source',
      quality: clamp01(source.quality ?? source.confidence ?? 0.5),
    })),
    evidenceCount: sources.length,
    budget: normalizeBudget(input),
    signals: {
      sourceCount: sources.length,
      hasContradictions: contradictions.length > 0,
      contradictionCount: contradictions.length,
      synthesisConfidence: clamp01(input.synthesisConfidence ?? 0),
      citationCoverage: clamp01(input.citationCoverage ?? 0),
    },
  };
}

export function normalizeAdaptiveSearchRewardForResearch(output = {}) {
  const base = average([
    output.sourceQuality,
    output.synthesisConfidence,
    output.citationCoverage,
    output.figureEvidenceQuality,
  ], 0.5);
  const contradictionBonus = output.contradictionResolved ? 0.08 : output.contradictionFound ? -0.08 : 0;
  return finalizeReward(base + contradictionBonus, output);
}

export function buildAdaptiveSearchContextForContextMemory(input = {}) {
  const retrievalItems = asArray(input.retrieval?.items ?? input.items);
  const sourcePaths = asArray(input.retrieval?.sourcePaths ?? input.sourcePaths);
  const memoryCandidates = asArray(input.memoryCandidates);

  return {
    subsystem: 'context_memory',
    taskId: input.taskId || 'context_memory_context',
    evidence: retrievalItems.map((item) => ({
      kind: item.type || 'retrieval_item',
      id: item.id || item.chunkId || item.path || 'item',
      score: clamp01(item.score ?? item.confidence ?? 0.5),
    })),
    evidenceCount: retrievalItems.length,
    budget: normalizeBudget(input),
    signals: {
      sourceDiversity: sourcePaths.length,
      graphDepth: Number(input.graph?.depth ?? 0),
      graphNeighborCount: asArray(input.graph?.neighbors).length,
      memoryCandidateCount: memoryCandidates.length,
      compactionPressure: clamp01(input.compaction?.pressure ?? input.compactionPressure ?? 0),
    },
  };
}

export function normalizeAdaptiveSearchRewardForContextMemory(output = {}) {
  const base = average([
    output.retrievalPrecision,
    output.sourceDiversity,
    output.graphRelevance,
    output.memoryUsefulness,
  ], 0.5);
  return finalizeReward(base - clamp01(output.compactionLoss ?? 0) * 0.18, output);
}

function normalizeBudget(input) {
  return {
    pressure: clamp01(input.budget?.pressure ?? input.budgetPressure ?? 0),
    remainingActions: input.budget?.remainingActions ?? input.remainingActions ?? null,
  };
}

function finalizeReward(value, output) {
  let reward = Number(value);
  if (!Number.isFinite(reward)) reward = 0.5;

  const pressure = clamp01(output.cost?.pressure ?? output.budgetPressure ?? 0);
  reward -= pressure * 0.12;

  if (Number.isFinite(output.cost?.latencyMs)) {
    reward -= Math.min(0.1, output.cost.latencyMs / 150000);
  }
  if (output.safetyRejected || output.approvalRejected || output.rejected) {
    reward *= 0.35;
  }

  return round(clamp01(reward));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function average(values, fallback) {
  const numeric = values.map((value) => Number(value)).filter(Number.isFinite).map(clamp01);
  if (!numeric.length) return fallback;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}
