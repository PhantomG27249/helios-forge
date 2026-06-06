export function scoreSubgoals({ subgoals, completedSubgoalIds = [] }) {
  const completedSet = new Set(completedSubgoalIds);
  const missingSubgoalIds = subgoals
    .filter((subgoal) => !completedSet.has(subgoal.id))
    .map((subgoal) => subgoal.id);

  const completed = subgoals.length - missingSubgoalIds.length;
  const total = subgoals.length;

  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
    missingSubgoalIds,
  };
}
