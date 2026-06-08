const BUDGET_FIELDS = ['usd', 'tokens', 'count', 'artifacts'];
const GATE_THRESHOLDS = [70, 80, 90, 100];

function emptyUsage() {
  return Object.fromEntries(BUDGET_FIELDS.map((field) => [field, 0]));
}

function normalizeUsage(usage = {}) {
  const normalized = emptyUsage();
  for (const field of BUDGET_FIELDS) {
    normalized[field] = Number(usage[field] || 0);
  }
  return normalized;
}

function addUsage(target, usage) {
  for (const field of BUDGET_FIELDS) {
    target[field] += usage[field] || 0;
  }
}

function percentUsed(used, limit) {
  if (!limit) return 0;
  return Math.round((used / limit) * 1000) / 10;
}

function cloneScope(scope) {
  return {
    id: scope.id,
    type: scope.type,
    parentId: scope.parentId,
    limits: { ...scope.limits },
    used: { ...scope.used },
    percentUsed: percentByField(scope),
  };
}

function percentByField(scope) {
  const percentages = {};
  for (const field of BUDGET_FIELDS) {
    if (scope.limits[field]) {
      percentages[field] = percentUsed(scope.used[field], scope.limits[field]);
    }
  }
  return percentages;
}

function budgetData({ field, used, limit }) {
  return {
    field,
    used,
    limit,
    percentUsed: percentUsed(used, limit),
  };
}

export class BudgetHierarchy {
  constructor({ rootScopeId, emitEvent = () => {} } = {}) {
    this.rootScopeId = rootScopeId;
    this.emitEvent = emitEvent;
    this.scopes = new Map();
    this.emitted = new Set();
  }

  defineScope({ id, type, parentId = null, limits = {} }) {
    if (!id) throw new Error('Budget scope id is required');
    if (!type) throw new Error(`Budget scope type is required for ${id}`);
    if (parentId && !this.scopes.has(parentId)) {
      throw new Error(`Unknown parent budget scope: ${parentId}`);
    }

    const scope = {
      id,
      type,
      parentId,
      limits: { ...limits },
      used: emptyUsage(),
    };
    this.scopes.set(id, scope);
    return cloneScope(scope);
  }

  recordUsage({ scopeId, usage = {} }) {
    const scope = this.scopes.get(scopeId);
    if (!scope) throw new Error(`Unknown budget scope: ${scopeId}`);

    const normalized = normalizeUsage(usage);
    const affectedScopes = [];
    let current = scope;
    while (current) {
      addUsage(current.used, normalized);
      affectedScopes.push(current);
      current = current.parentId ? this.scopes.get(current.parentId) : null;
    }

    for (const affectedScope of affectedScopes) {
      this.emitThresholdEvents(affectedScope);
    }

    return cloneScope(scope);
  }

  emitThresholdEvents(scope) {
    for (const field of BUDGET_FIELDS) {
      const limit = scope.limits[field];
      if (!limit) continue;

      const data = budgetData({ field, used: scope.used[field], limit });
      for (const threshold of GATE_THRESHOLDS) {
        if (data.percentUsed < threshold) continue;
        const key = `${scope.id}:${field}:${threshold}`;
        if (this.emitted.has(key)) continue;
        this.emitted.add(key);

        this.emitEvent({
          type: 'budget.gate',
          scopeId: scope.id,
          scopeType: scope.type,
          threshold,
          data,
        });

        if (threshold === 90) {
          this.emitEvent({
            type: 'budget.downshift_recommended',
            scopeId: scope.id,
            scopeType: scope.type,
            threshold,
            data,
            recommendation: {
              action: 'downshift_model_or_reduce_retrieval',
              reason: `${field}_budget_pressure`,
            },
          });
        }

        if (threshold === 100) {
          this.emitEvent({
            type: 'budget.exhausted',
            scopeId: scope.id,
            scopeType: scope.type,
            threshold,
            data,
          });
        }
      }
    }
  }

  snapshot() {
    const scopes = [...this.scopes.values()].map(cloneScope);
    return {
      rootScopeId: this.rootScopeId,
      scopes,
      byId: Object.fromEntries(scopes.map((scope) => [scope.id, scope])),
    };
  }
}
