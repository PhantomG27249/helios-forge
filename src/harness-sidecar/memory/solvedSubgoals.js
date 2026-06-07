export function recordSolvedSubgoal({
  graph,
  taskId,
  subgoalId,
  description,
  evidence = [],
  validatorBacked = true,
} = {}) {
  if (!graph) throw new Error('graph is required');
  if (!subgoalId) throw new Error('subgoalId is required');

  return graph.addMemory({
    type: 'solved_subgoal',
    summary: description,
    subgoalId,
    evidence,
    reviewStatus: 'reviewed',
    validatorBacked,
    createdByTask: taskId,
  });
}
