function makeBriefId() {
  return `brief_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeScope(scope = {}) {
  return {
    include: Array.isArray(scope.include) ? scope.include : [],
    exclude: Array.isArray(scope.exclude) ? scope.exclude : [],
    notes: scope.notes || '',
  };
}

function normalizeBudget(budget = {}) {
  return {
    maxSources: budget.maxSources ?? null,
    maxMinutes: budget.maxMinutes ?? null,
    maxTokens: budget.maxTokens ?? null,
  };
}

export function createResearchBrief({
  task,
  question,
  scope = {},
  budget = {},
} = {}) {
  return {
    briefId: makeBriefId(),
    task: task || '',
    question: question || '',
    scope: normalizeScope(scope),
    budget: normalizeBudget(budget),
    status: 'ready_for_discovery',
    createdAt: new Date().toISOString(),
  };
}
