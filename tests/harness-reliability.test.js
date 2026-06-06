import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BudgetManager } from '../src/harness-sidecar/budget/budgetManager.js';
import { createRecoveryEvent } from '../src/harness-sidecar/reliability/errorRecovery.js';
import { LoopDetector } from '../src/harness-sidecar/reliability/loopDetector.js';

test('budget manager emits budget updates and threshold gates', () => {
  const events = [];
  const budget = new BudgetManager({
    taskId: 'task_budget',
    limits: { maxToolCalls: 10, maxWallMinutes: 30 },
    emitEvent: (event) => events.push(event),
  });

  budget.recordUsage({ toolCalls: 5 });
  budget.recordUsage({ toolCalls: 3 });
  budget.recordUsage({ toolCalls: 1 });
  budget.recordUsage({ toolCalls: 1 });

  assert.equal(budget.getState().used.toolCalls, 10);
  assert.equal(events.some((event) => event.type === 'budget.updated'), true);
  assert.equal(events.some((event) => event.type === 'budget.gate' && event.percent === 50), true);
  assert.equal(events.some((event) => event.type === 'budget.gate' && event.percent === 75), true);
  assert.equal(events.some((event) => event.type === 'budget.gate' && event.percent === 90 && event.action === 'approval_required'), true);
  assert.equal(events.some((event) => event.type === 'budget.gate' && event.percent === 100 && event.action === 'hard_stop'), true);
});

test('recovery event includes category, recoverability, and task provenance', () => {
  const event = createRecoveryEvent({
    taskId: 'task_recovery',
    category: 'tool_timeout',
    recoverability: 'retryable',
    summary: 'Verifier timed out after 60 seconds',
    detail: { verifier: 'unit' },
  });

  assert.equal(event.type, 'recovery.event');
  assert.equal(event.taskId, 'task_recovery');
  assert.equal(event.category, 'tool_timeout');
  assert.equal(event.recoverability, 'retryable');
  assert.equal(event.detail.verifier, 'unit');
});

test('loop detector reports no progress after repeated identical signatures', () => {
  const detector = new LoopDetector({ threshold: 3 });

  assert.equal(detector.record('pytest failed: same assertion').loopDetected, false);
  assert.equal(detector.record('pytest failed: same assertion').loopDetected, false);

  const result = detector.record('pytest failed: same assertion');
  assert.equal(result.loopDetected, true);
  assert.equal(result.signature, 'pytest failed: same assertion');
  assert.equal(result.count, 3);
});
