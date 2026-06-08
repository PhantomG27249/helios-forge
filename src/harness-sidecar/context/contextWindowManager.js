import { createWorkingMemory } from './workingMemory.js';
import { planCompaction } from './compactionPlanner.js';

const THRESHOLDS = [
  {
    percent: 95,
    status: 'stop',
    actions: [
      'summarize_older_tool_outputs',
      'compress_raw_logs',
      'freeze_decision_ledger',
      'rebuild_context_pack',
      'request_budget_or_profile_change',
    ],
  },
  {
    percent: 90,
    status: 'rebuild',
    actions: [
      'summarize_older_tool_outputs',
      'compress_raw_logs',
      'freeze_decision_ledger',
      'rebuild_context_pack',
    ],
  },
  {
    percent: 80,
    status: 'compress',
    actions: [
      'summarize_older_tool_outputs',
      'compress_raw_logs',
    ],
  },
  {
    percent: 70,
    status: 'summarize',
    actions: ['summarize_older_tool_outputs'],
  },
];

function pressurePercent({ usedTokens = 0, maxTokens = 1 }) {
  if (!maxTokens) return 0;
  return Math.max(0, Math.round((usedTokens / maxTokens) * 100));
}

function thresholdFor(percent) {
  return THRESHOLDS.find((threshold) => percent >= threshold.percent) || {
    percent: 0,
    status: 'ok',
    actions: [],
  };
}

export function evaluateContextWindow({
  taskId,
  maxTokens,
  usedTokens = 0,
  items = [],
  decisionLedger = null,
  task = {},
  profile,
  trigger,
} = {}) {
  const percent = pressurePercent({ usedTokens, maxTokens });
  const threshold = thresholdFor(percent);
  const workingMemory = createWorkingMemory({ taskId, maxTokens });

  for (const item of items) {
    workingMemory.remember(item);
  }

  const packed = workingMemory.pack({
    pressurePercent: percent,
    maxTokens,
  });
  const decisionLedgerSnapshot = threshold.percent >= 90 && decisionLedger?.snapshot
    ? decisionLedger.snapshot()
    : null;
  const compactionPlan = planCompaction({
    task: {
      taskId,
      ...task,
    },
    pressureState: {
      pressurePercent: percent,
      maxTokens,
    },
    items,
    profile,
    trigger,
  });

  return {
    taskId,
    status: threshold.status,
    threshold: threshold.percent,
    pressurePercent: percent,
    actions: [...threshold.actions],
    contextPack: {
      taskId,
      items: packed.items,
      maxTokens,
      tokensEstimated: packed.tokensEstimated,
      rebuilt: threshold.percent >= 90,
      decisionLedger: decisionLedgerSnapshot,
    },
    droppedItems: packed.droppedItems,
    compressedItems: packed.compressedItems,
    retainedP0Items: packed.retainedP0Items,
    compactionPlan,
    decisionLedgerFrozen: threshold.percent >= 90,
    requiresOperatorAction: threshold.percent >= 95,
  };
}
