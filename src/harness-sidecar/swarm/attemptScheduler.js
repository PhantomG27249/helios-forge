import { seedAttemptStrategies } from '../bes/strategySeeder.js';
import { planToolTree } from '../bes/toolTreePlanner.js';
import { planEvolutionSwarmAttempts } from './evolutionSwarmPlanner.js';

function isToolTreePlannerEnabled(planner = {}) {
  return planner?.enabled === true && planner.strategy === 'tooltree';
}

function fallbackAttempts({ taskId, taskType, maxAttempts }) {
  return seedAttemptStrategies({ taskType, maxAttempts }).map((strategy, index) => ({
    attemptId: `attempt_${index + 1}`,
    taskId,
    strategy: strategy.name,
    budgetWeight: strategy.budgetWeight,
    status: 'pending',
    verifierPassed: false,
    score: 0,
  }));
}

function strategyForPlan(plan, index) {
  return plan.action?.strategy || plan.action?.name || plan.state?.strategy || `tooltree_plan_${index + 1}`;
}

function scheduledToolTreeAttempts({ taskId, taskType, maxAttempts, planner }) {
  const seeded = seedAttemptStrategies({ taskType, maxAttempts });
  const planningResult = planToolTree({
    task: planner.task || taskId,
    rootState: planner.rootState || { taskId, taskType },
    budget: planner.budget,
    expandNode: planner.expandNode,
    evaluateNode: planner.evaluateNode,
    now: planner.now,
  });
  const selectedPlans = planningResult.selectedPlans.slice(0, maxAttempts);
  const plannedAttempts = selectedPlans.map((plan, index) => ({
    attemptId: `attempt_${index + 1}`,
    taskId,
    strategy: strategyForPlan(plan, index),
    budgetWeight: Math.max(0.1, 1 - (index * 0.1)),
    status: 'pending',
    verifierPassed: false,
    score: 0,
    planning: {
      strategy: 'tooltree',
      rank: index + 1,
      score: plan.meanValue,
      toolPlan: plan,
      budget: planningResult.budget,
    },
  }));

  if (plannedAttempts.length >= maxAttempts) return plannedAttempts;

  const plannedStrategies = new Set(plannedAttempts.map((attempt) => attempt.strategy));
  const fillAttempts = seeded
    .filter((strategy) => !plannedStrategies.has(strategy.name))
    .slice(0, maxAttempts - plannedAttempts.length)
    .map((strategy, index) => ({
      attemptId: `attempt_${plannedAttempts.length + index + 1}`,
      taskId,
      strategy: strategy.name,
      budgetWeight: strategy.budgetWeight,
      status: 'pending',
      verifierPassed: false,
      score: 0,
      planning: {
        strategy: 'seeded_fallback',
        rank: plannedAttempts.length + index + 1,
        score: 0,
        toolPlan: null,
        budget: planningResult.budget,
      },
    }));

  return [...plannedAttempts, ...fillAttempts];
}

export function scheduleAttempts({
  taskId,
  taskType = 'general',
  maxAttempts = 4,
  planner = {},
  evolutionPlanner,
} = {}) {
  const activeEvolutionPlanner = evolutionPlanner || planner?.evolutionPlanner;
  const seeded = fallbackAttempts({ taskId, taskType, maxAttempts });
  const hasEvolutionInputs = activeEvolutionPlanner?.enabled === true && (
    (Array.isArray(activeEvolutionPlanner.evolutionArchive) && activeEvolutionPlanner.evolutionArchive.length > 0)
    || (Array.isArray(activeEvolutionPlanner.evolutionArchive?.archive) && activeEvolutionPlanner.evolutionArchive.archive.length > 0)
    || (Array.isArray(activeEvolutionPlanner.bidirectionalBes?.frontier) && activeEvolutionPlanner.bidirectionalBes.frontier.length > 0)
  );

  if (hasEvolutionInputs) {
    return planEvolutionSwarmAttempts({
      taskId,
      taskType,
      maxAttempts,
      bidirectionalBes: activeEvolutionPlanner.bidirectionalBes,
      evolutionArchive: activeEvolutionPlanner.evolutionArchive,
      rhoCoreset: activeEvolutionPlanner.rhoCoreset,
      fallbackAttempts: seeded,
    });
  }

  if (isToolTreePlannerEnabled(planner)) {
    return scheduledToolTreeAttempts({ taskId, taskType, maxAttempts, planner });
  }

  return seeded;
}
