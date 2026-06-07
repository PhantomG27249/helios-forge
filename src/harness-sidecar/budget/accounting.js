const USAGE_FIELDS = [
  'inputTokens',
  'outputTokens',
  'tokensEstimated',
  'toolCalls',
  'verifierCalls',
  'artifacts',
  'wallMinutes',
];

function emptyUsage() {
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0]));
}

function addUsage(target, record) {
  for (const field of USAGE_FIELDS) {
    target[field] += record[field] || 0;
  }
}

export class BudgetLedger {
  constructor({ taskId }) {
    this.taskId = taskId;
    this.records = [];
  }

  record(usage) {
    const entry = {
      recordedAt: new Date().toISOString(),
      scope: usage.scope || 'task',
      kind: usage.kind || 'unknown',
      ...usage,
    };
    this.records.push(entry);
    return entry;
  }

  summary() {
    const used = emptyUsage();
    const byScope = {};

    for (const record of this.records) {
      addUsage(used, record);
      byScope[record.scope] ||= emptyUsage();
      addUsage(byScope[record.scope], record);
    }

    return {
      taskId: this.taskId,
      used,
      byScope,
      records: [...this.records],
    };
  }
}
