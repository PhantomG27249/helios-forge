import { seedAttemptStrategies } from '../bes/strategySeeder.js';

export function scheduleAttempts({ taskId, taskType = 'general', maxAttempts = 4 }) {
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
