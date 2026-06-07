function makeAttemptKey(taskId, strategySignature) {
  return `${taskId || 'global'}::${strategySignature}`;
}

export function recordDeadEndAttempt({
  graph,
  taskId,
  strategySignature,
  failure,
  evidence = [],
  threshold = 3,
} = {}) {
  if (!graph) throw new Error('graph is required');
  if (!strategySignature) throw new Error('strategySignature is required');

  if (!graph.deadEndAttempts) graph.deadEndAttempts = new Map();

  const key = makeAttemptKey(taskId, strategySignature);
  const attempts = graph.deadEndAttempts.get(key) || [];
  attempts.push({ failure, evidence: Array.isArray(evidence) ? evidence : [evidence] });
  graph.deadEndAttempts.set(key, attempts);

  if (attempts.length < threshold) {
    return { count: attempts.length, memory: null };
  }

  const existing = graph.findByType('dead_end').find((memory) => (
    memory.strategySignature === strategySignature
    && memory.createdByTask === taskId
  ));
  if (existing) {
    return { count: attempts.length, memory: existing };
  }

  const memory = graph.addMemory({
    type: 'dead_end',
    summary: `Repeated failed strategy: ${strategySignature}`,
    strategySignature,
    failure,
    failures: attempts.map((attempt) => attempt.failure),
    evidence: attempts.flatMap((attempt) => attempt.evidence),
    reviewStatus: 'candidate',
    validatorBacked: false,
    createdByTask: taskId,
  });

  return { count: attempts.length, memory };
}
