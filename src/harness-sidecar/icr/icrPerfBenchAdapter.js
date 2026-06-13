function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function roundMetric(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(6));
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function normalizeBaselineImplementation(input, language) {
  const baseline = requireObject(input, 'baselineImplementation');
  if (!baseline.code) throw new Error('baselineImplementation.code is required');
  return {
    language: String(baseline.language ?? language ?? 'javascript'),
    entrypoint: String(baseline.entrypoint ?? 'solve'),
    code: String(baseline.code),
    complexity: String(baseline.complexity ?? 'unknown'),
  };
}

function normalizeCorrectnessCheck(input) {
  const correctness = requireObject(input, 'correctnessCheck');
  const cases = asArray(correctness.cases);
  return {
    kind: String(correctness.kind ?? 'unit_tests'),
    command: correctness.command === undefined ? null : String(correctness.command),
    caseCount: Number(correctness.caseCount ?? cases.length),
    cases,
  };
}

function normalizeRuntimeScore(input) {
  const runtime = requireObject(input, 'runtimeScore');
  const baselineMs = Number(runtime.baselineMs);
  if (!Number.isFinite(baselineMs) || baselineMs <= 0) {
    throw new Error('runtimeScore.baselineMs must be a positive finite number');
  }
  return {
    kind: String(runtime.kind ?? 'relative_runtime'),
    metric: String(runtime.metric ?? 'median_ms'),
    baselineMs,
    lowerIsBetter: runtime.lowerIsBetter !== false,
  };
}

function normalizeReferenceOptimized(input) {
  const reference = input?.referenceOptimized ?? {};
  const metadata = {
    ...(reference.metadata ?? {}),
  };
  return {
    implementationId: String(reference.implementationId ?? reference.id ?? 'reference_optimized'),
    metadata,
  };
}

function normalizeBottlenecks(input) {
  return asArray(input?.bottlenecks).map((bottleneck, index) => ({
    id: String(bottleneck?.id ?? `bottleneck_${index + 1}`),
    summary: String(bottleneck?.summary ?? bottleneck?.description ?? 'Performance bottleneck hypothesis'),
    target: String(bottleneck?.target ?? bottleneck?.proposedDirection ?? 'improve runtime efficiency'),
    expectedImpact: String(bottleneck?.expectedImpact ?? 'unknown'),
  }));
}

function normalizeTask(task) {
  if (task?.kind === 'icr_perfbench_task') return task;
  return createIcrPerfBenchTask(task);
}

function referenceMsFor(task, runtimeResult = {}) {
  const explicit = Number(runtimeResult.referenceMs);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const metadataValue = Number(task.referenceOptimized?.metadata?.referenceMs);
  return Number.isFinite(metadataValue) && metadataValue > 0 ? metadataValue : null;
}

function runtimeEfficiencyScore({ baselineMs, candidateMs, referenceMs, lowerIsBetter }) {
  if (!Number.isFinite(candidateMs) || candidateMs <= 0) {
    return {
      speedupVsBaseline: 0,
      efficiencyVsReference: 0,
      score: 0,
    };
  }

  if (lowerIsBetter) {
    const speedupVsBaseline = baselineMs / candidateMs;
    const efficiencyVsReference = referenceMs ? Math.min(1, referenceMs / candidateMs) : 0;
    const score = Math.max(0, Math.min(1, (baselineMs - candidateMs) / baselineMs));
    return {
      speedupVsBaseline: roundMetric(speedupVsBaseline),
      efficiencyVsReference: roundMetric(efficiencyVsReference),
      score: roundMetric(score),
    };
  }

  const speedupVsBaseline = candidateMs / baselineMs;
  const efficiencyVsReference = referenceMs ? Math.min(1, candidateMs / referenceMs) : 0;
  const score = Math.max(0, Math.min(1, (candidateMs - baselineMs) / candidateMs));
  return {
    speedupVsBaseline: roundMetric(speedupVsBaseline),
    efficiencyVsReference: roundMetric(efficiencyVsReference),
    score: roundMetric(score),
  };
}

export function createIcrPerfBenchTask(input = {}) {
  const source = requireObject(input, 'perfBenchTask');
  const taskId = String(source.taskId ?? source.id ?? '');
  if (!taskId) throw new Error('taskId is required');

  const baselineImplementation = normalizeBaselineImplementation(
    source.baselineImplementation,
    source.language,
  );

  return {
    kind: 'icr_perfbench_task',
    lane: 'icr',
    taskId,
    title: String(source.title ?? taskId),
    prompt: String(source.prompt ?? ''),
    baselineImplementation,
    correctnessCheck: normalizeCorrectnessCheck(source.correctnessCheck),
    runtimeScore: normalizeRuntimeScore(source.runtimeScore),
    referenceOptimized: normalizeReferenceOptimized(source),
    bottlenecks: normalizeBottlenecks(source),
    source: 'inline_perfcodebench_style',
    externalBenchmarkDependency: false,
    evidenceOnly: true,
    promotionAllowed: false,
  };
}

export function evaluateIcrPerfBenchCandidate({
  task: rawTask,
  candidate = {},
  correctnessResult = {},
  runtimeResult = {},
} = {}) {
  const task = normalizeTask(rawTask);
  const passedCount = Number(correctnessResult.passedCount ?? 0);
  const totalCount = Number(correctnessResult.totalCount ?? task.correctnessCheck.caseCount ?? 0);
  const passed = correctnessResult.passed === true || (totalCount > 0 && passedCount === totalCount);
  const baselineMs = Number(runtimeResult.baselineMs ?? task.runtimeScore.baselineMs);
  const candidateMs = Number(runtimeResult.candidateMs);
  const referenceMs = referenceMsFor(task, runtimeResult);
  const runtimeMetrics = runtimeEfficiencyScore({
    baselineMs,
    candidateMs,
    referenceMs,
    lowerIsBetter: task.runtimeScore.lowerIsBetter,
  });
  const failures = asArray(correctnessResult.failures).map(String);
  const blockingEvidence = [];
  if (!passed) blockingEvidence.push('correctness_failed');

  return {
    kind: 'icr_perfbench_evaluation',
    lane: 'icr',
    taskId: task.taskId,
    candidateId: String(candidate.candidateId ?? candidate.id ?? 'candidate'),
    branchId: candidate.branchId === undefined ? null : String(candidate.branchId),
    correctness: {
      passed,
      passedCount,
      totalCount,
      passRate: totalCount > 0 ? roundMetric(passedCount / totalCount) : 0,
      failures,
    },
    runtimeEfficiency: {
      metric: task.runtimeScore.metric,
      baselineMs,
      candidateMs,
      referenceMs,
      ...runtimeMetrics,
      samples: asArray(runtimeResult.samples),
    },
    blockingEvidence,
    evidenceOnly: true,
    promotionAllowed: false,
  };
}

export function createIcrPerfBenchBranchHypotheses(rawTask) {
  const task = normalizeTask(rawTask);
  return {
    kind: 'icr_perfbench_branch_hypothesis_packet',
    lane: 'icr',
    taskId: task.taskId,
    hypotheses: task.bottlenecks.map((bottleneck) => ({
      hypothesisId: `${task.taskId}_hypothesis_${bottleneck.id}`,
      branchId: `branch_${bottleneck.id}`,
      sourceBottleneckId: bottleneck.id,
      targetField: 'runtime_efficiency',
      statement: bottleneck.summary,
      proposedDirection: bottleneck.target,
      expectedImpact: bottleneck.expectedImpact,
    })),
    evidenceOnly: true,
    promotionAllowed: false,
  };
}

export function createIcrPerfBenchReplayCase(rawTask) {
  const task = normalizeTask(rawTask);
  return {
    taskId: task.taskId,
    prompt: `${task.prompt}\n\nBaseline entrypoint: ${task.baselineImplementation.entrypoint}`,
    perfBenchTask: task,
    baseline: {
      implementation: task.baselineImplementation,
      runtimeScore: task.runtimeScore,
    },
    rubric: {
      correctness: task.correctnessCheck,
      runtimeEfficiency: task.runtimeScore,
      referenceOptimized: task.referenceOptimized,
    },
    heldoutVariants: [
      { variantId: 'correctness', focus: 'correctness' },
      { variantId: 'runtime_efficiency', focus: 'runtime_efficiency' },
    ],
  };
}
