const DASHBOARD_FIELDS = ['usd', 'tokens', 'count', 'artifacts'];

function maxPercentByField(scopes = []) {
  const percentUsed = {};
  for (const field of DASHBOARD_FIELDS) {
    const fieldValues = scopes
      .map((scope) => scope.percentUsed?.[field])
      .filter((value) => typeof value === 'number');
    if (fieldValues.length > 0) {
      percentUsed[field] = Math.max(...fieldValues);
    }
  }
  return percentUsed;
}

function totalUsedByField(scopes = []) {
  const totals = {};
  for (const field of DASHBOARD_FIELDS) {
    totals[field] = scopes
      .filter((scope) => scope.parentId === null || scope.parentId === undefined)
      .reduce((sum, scope) => sum + (scope.used?.[field] || 0), 0);
  }
  return totals;
}

export function buildBudgetDashboard({
  context = {},
  budget = {},
  subagents = [],
  approvals = [],
  recovery = {},
} = {}) {
  const scopes = budget.scopes || [];

  return {
    context: {
      taskId: context.taskId,
      pressurePercent: context.pressurePercent || 0,
      threshold: context.threshold || 0,
      actions: [...(context.actions || [])],
    },
    budget: {
      rootScopeId: budget.rootScopeId,
      percentUsed: maxPercentByField(scopes),
      used: totalUsedByField(scopes),
      scopes,
    },
    activeSubagents: subagents.filter((subagent) => subagent.status === 'running').length,
    pendingApprovals: approvals.length,
    latestRecoveryStatus: recovery.status || recovery.latest?.status || 'unknown',
    recovery,
  };
}
