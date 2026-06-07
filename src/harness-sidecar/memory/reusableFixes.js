export function recordReusableFix({
  graph,
  taskId,
  pattern,
  appliesTo = [],
  evidence = [],
  supports = [],
  validatorBacked = true,
} = {}) {
  if (!graph) throw new Error('graph is required');
  if (!pattern) throw new Error('pattern is required');

  const memory = graph.addMemory({
    type: 'reusable_fix',
    summary: pattern,
    pattern,
    appliesTo: Array.isArray(appliesTo) ? appliesTo : [appliesTo],
    evidence,
    reviewStatus: 'reviewed',
    validatorBacked,
    createdByTask: taskId,
  });

  const supportSources = supports.length > 0
    ? supports
    : graph.findByType('solved_subgoal').map((subgoal) => subgoal.memoryId);

  for (const sourceId of supportSources) {
    graph.addRelation({
      from: sourceId,
      to: memory.memoryId,
      type: 'supports',
      provenance: [{ taskId, evidence }],
    });
  }

  return memory;
}
