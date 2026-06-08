import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateContextWindow } from '../src/harness-sidecar/context/contextWindowManager.js';
import { createWorkingMemory } from '../src/harness-sidecar/context/workingMemory.js';

function makeItems() {
  return [
    {
      id: 'system-instructions',
      priority: 0,
      type: 'instruction',
      content: 'Never drop the operator instructions.',
      tokensEstimated: 200,
    },
    {
      id: 'decision-ledger',
      priority: 0,
      type: 'decision_ledger',
      content: 'Decision: keep the sidecar orchestration boundary.',
      tokensEstimated: 180,
    },
    {
      id: 'tool-output-old',
      priority: 3,
      type: 'tool_output',
      content: 'old tool output '.repeat(80),
      tokensEstimated: 900,
      age: 10,
    },
    {
      id: 'raw-log',
      priority: 4,
      type: 'raw_log',
      content: 'verbose log line '.repeat(120),
      tokensEstimated: 1200,
    },
    {
      id: 'low-priority-note',
      priority: 8,
      type: 'note',
      content: 'Low priority note that can be rebuilt from trace.',
      tokensEstimated: 700,
    },
  ];
}

test('context pressure at 70 percent summarizes older tool outputs and retains P0 memory', () => {
  const state = evaluateContextWindow({
    taskId: 'task_context',
    maxTokens: 1000,
    usedTokens: 700,
    items: makeItems(),
  });

  assert.equal(state.status, 'summarize');
  assert.equal(state.threshold, 70);
  assert.equal(state.actions.includes('summarize_older_tool_outputs'), true);
  assert.deepEqual(
    state.retainedP0Items.map((item) => item.id),
    ['system-instructions', 'decision-ledger'],
  );
  assert.equal(state.compressedItems.some((item) => item.id === 'tool-output-old'), true);
  assert.equal(state.contextPack.items.some((item) => item.id === 'system-instructions'), true);
});

test('context pressure at 80 percent compresses raw logs before dropping rebuildable items', () => {
  const state = evaluateContextWindow({
    taskId: 'task_context',
    maxTokens: 1000,
    usedTokens: 805,
    items: makeItems(),
  });

  assert.equal(state.status, 'compress');
  assert.equal(state.threshold, 80);
  assert.equal(state.actions.includes('compress_raw_logs'), true);
  assert.equal(state.compressedItems.some((item) => item.id === 'raw-log'), true);
  assert.equal(state.droppedItems.some((item) => item.id === 'low-priority-note'), true);
  assert.equal(state.contextPack.items.some((item) => item.priority === 0), true);
});

test('context pressure at 90 percent freezes the decision ledger and rebuilds the context pack', () => {
  const state = evaluateContextWindow({
    taskId: 'task_context',
    maxTokens: 1000,
    usedTokens: 905,
    items: makeItems(),
    decisionLedger: {
      snapshot: () => ({
        decisions: [{ decision: 'Use budget gates', evidence: ['plan'] }],
        rejectedApproaches: [{ approach: 'UI-first wiring', reason: 'Core modules first' }],
      }),
    },
  });

  assert.equal(state.status, 'rebuild');
  assert.equal(state.threshold, 90);
  assert.equal(state.actions.includes('freeze_decision_ledger'), true);
  assert.equal(state.actions.includes('rebuild_context_pack'), true);
  assert.equal(state.decisionLedgerFrozen, true);
  assert.equal(state.contextPack.rebuilt, true);
  assert.equal(state.contextPack.decisionLedger.decisions.length, 1);
  assert.equal(state.compactionPlan.profile, 'coding');
  assert.equal(state.compactionPlan.trigger, 'auto');
  assert.equal(state.compactionPlan.targetTokens, 550);
  assert.equal(state.compactionPlan.actions.includes('rebuild_context_pack'), true);
  assert.equal(state.compactionPlan.mustKeepItemIds.includes('system-instructions'), true);
});

test('context pressure at 95 percent stops and requests a budget or profile change', () => {
  const state = evaluateContextWindow({
    taskId: 'task_context',
    maxTokens: 1000,
    usedTokens: 951,
    items: makeItems(),
  });

  assert.equal(state.status, 'stop');
  assert.equal(state.threshold, 95);
  assert.equal(state.actions.includes('request_budget_or_profile_change'), true);
  assert.equal(state.requiresOperatorAction, true);
});

test('context pressure uses visual profile when task needs VLM artifacts', () => {
  const state = evaluateContextWindow({
    taskId: 'task_visual',
    maxTokens: 1000,
    usedTokens: 805,
    task: {
      kind: 'visual verifier screenshot diff',
    },
    items: [
      ...makeItems(),
      {
        id: 'page-shot',
        priority: 5,
        type: 'screenshot',
        path: 'artifacts/home.png',
        content: 'browser screenshot for visual verifier',
        tokensEstimated: 500,
      },
    ],
  });

  assert.equal(state.compactionPlan.profile, 'visual');
  assert.equal(state.compactionPlan.mustKeepItemIds.includes('page-shot'), true);
  assert.equal(state.compactionPlan.expectedArtifactFields.includes('riskFlags'), true);
});

test('working memory keeps priority-zero facts while compressing and dropping lower priority context', () => {
  const memory = createWorkingMemory({
    taskId: 'task_memory',
    maxTokens: 500,
  });

  for (const item of makeItems()) {
    memory.remember(item);
  }

  const packed = memory.pack({ pressurePercent: 90 });

  assert.equal(packed.retainedP0Items.length, 2);
  assert.equal(packed.items.some((item) => item.id === 'system-instructions'), true);
  assert.equal(packed.compressedItems.some((item) => item.id === 'tool-output-old'), true);
  assert.equal(packed.droppedItems.some((item) => item.id === 'low-priority-note'), true);
});
