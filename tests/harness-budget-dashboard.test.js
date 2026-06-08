import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildBudgetDashboard } from '../src/harness-sidecar/budget/budgetDashboard.js';
import { BudgetHierarchy } from '../src/harness-sidecar/budget/budgetHierarchy.js';
import { recommendCostAwareAllocation } from '../src/harness-sidecar/budget/costAwareAllocator.js';

test('budget hierarchy tracks workspace task swarm subagent call tool and vision artifact scopes', () => {
  const events = [];
  const hierarchy = new BudgetHierarchy({
    rootScopeId: 'workspace:helios',
    emitEvent: (event) => events.push(event),
  });

  hierarchy.defineScope({ id: 'workspace:helios', type: 'workspace', limits: { usd: 10, tokens: 10000 } });
  hierarchy.defineScope({ id: 'task:wave4', type: 'task', parentId: 'workspace:helios', limits: { usd: 5, tokens: 5000 } });
  hierarchy.defineScope({ id: 'swarm:review', type: 'swarm', parentId: 'task:wave4', limits: { usd: 2, tokens: 2000 } });
  hierarchy.defineScope({ id: 'subagent:critic', type: 'subagent', parentId: 'swarm:review', limits: { usd: 1, tokens: 1000 } });
  hierarchy.defineScope({ id: 'model:call1', type: 'model_call', parentId: 'subagent:critic', limits: { usd: 0.5, tokens: 500 } });
  hierarchy.defineScope({ id: 'tool:call1', type: 'tool_call', parentId: 'task:wave4', limits: { count: 10 } });
  hierarchy.defineScope({ id: 'vision:artifact1', type: 'vision_artifact', parentId: 'task:wave4', limits: { artifacts: 2 } });

  hierarchy.recordUsage({ scopeId: 'model:call1', usage: { usd: 0.35, tokens: 360 } });
  hierarchy.recordUsage({ scopeId: 'tool:call1', usage: { count: 7 } });
  hierarchy.recordUsage({ scopeId: 'vision:artifact1', usage: { artifacts: 1 } });

  const snapshot = hierarchy.snapshot();

  assert.deepEqual(
    snapshot.scopes.map((scope) => scope.type),
    ['workspace', 'task', 'swarm', 'subagent', 'model_call', 'tool_call', 'vision_artifact'],
  );
  assert.equal(snapshot.byId['workspace:helios'].used.usd, 0.35);
  assert.equal(snapshot.byId['task:wave4'].used.count, 7);
  assert.equal(snapshot.byId['vision:artifact1'].used.artifacts, 1);
  assert.equal(events.some((event) => event.type === 'budget.gate' && event.scopeId === 'model:call1'), true);
});

test('budget hierarchy emits data-form gate downshift and exhausted events', () => {
  const events = [];
  const hierarchy = new BudgetHierarchy({
    rootScopeId: 'workspace:helios',
    emitEvent: (event) => events.push(event),
  });

  hierarchy.defineScope({ id: 'workspace:helios', type: 'workspace', limits: { tokens: 1000 } });
  hierarchy.defineScope({ id: 'task:wave4', type: 'task', parentId: 'workspace:helios', limits: { tokens: 1000 } });

  hierarchy.recordUsage({ scopeId: 'task:wave4', usage: { tokens: 800 } });
  hierarchy.recordUsage({ scopeId: 'task:wave4', usage: { tokens: 120 } });
  hierarchy.recordUsage({ scopeId: 'task:wave4', usage: { tokens: 90 } });

  const gate = events.find((event) => event.type === 'budget.gate' && event.threshold === 70);
  const downshift = events.find((event) => event.type === 'budget.downshift_recommended');
  const exhausted = events.find((event) => event.type === 'budget.exhausted');

  assert.deepEqual(Object.keys(gate.data).sort(), ['field', 'limit', 'percentUsed', 'used']);
  assert.equal(gate.scopeType, 'task');
  assert.equal(downshift.recommendation.action, 'downshift_model_or_reduce_retrieval');
  assert.equal(exhausted.data.percentUsed >= 100, true);
});

test('cost aware allocator reduces retrieval and swarm breadth under budget pressure', () => {
  const allocation = recommendCostAwareAllocation({
    pressure: {
      contextPercent: 88,
      budgetPercent: 92,
    },
    desired: {
      retrievalItems: 12,
      subagents: 5,
      modelProfile: 'qwen36_vlm_deep',
    },
  });

  assert.equal(allocation.modelProfile, 'critic_low_temp');
  assert.equal(allocation.retrievalItems < 12, true);
  assert.equal(allocation.subagents < 5, true);
  assert.equal(allocation.events.some((event) => event.type === 'budget.downshift_recommended'), true);
});

test('budget dashboard exposes compact context budget and operator status data', () => {
  const hierarchy = new BudgetHierarchy({ rootScopeId: 'workspace:helios' });
  hierarchy.defineScope({ id: 'workspace:helios', type: 'workspace', limits: { tokens: 1000, usd: 10 } });
  hierarchy.defineScope({ id: 'task:wave4', type: 'task', parentId: 'workspace:helios', limits: { tokens: 500, usd: 5 } });
  hierarchy.recordUsage({ scopeId: 'task:wave4', usage: { tokens: 350, usd: 1.25 } });

  const dashboard = buildBudgetDashboard({
    context: {
      taskId: 'task_context',
      threshold: 80,
      pressurePercent: 84,
      actions: ['compress_raw_logs'],
    },
    budget: hierarchy.snapshot(),
    subagents: [{ id: 'critic', status: 'running' }],
    approvals: [{ actionId: 'act_1', risk: 'high' }],
    recovery: { status: 'stable', latest: null },
  });

  assert.equal(dashboard.context.pressurePercent, 84);
  assert.equal(dashboard.budget.percentUsed.tokens, 70);
  assert.equal(dashboard.budget.percentUsed.usd, 25);
  assert.equal(dashboard.activeSubagents, 1);
  assert.equal(dashboard.pendingApprovals, 1);
  assert.equal(dashboard.latestRecoveryStatus, 'stable');
});
