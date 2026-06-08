import { classifyHarnessFailure } from './errorTaxonomy.js';

function nowIso() {
  return new Date().toISOString();
}

export class DegradedModeRegistry {
  constructor({ taskId, emitEvent } = {}) {
    this.taskId = taskId;
    this.emitEvent = typeof emitEvent === 'function' ? emitEvent : () => {};
    this.modes = [];
  }

  enter({
    mode,
    category,
    reason,
    detail = {},
    severity,
  } = {}) {
    const classification = classifyHarnessFailure({ category, reason });
    const record = {
      type: 'recovery.degraded_mode_entered',
      taskId: this.taskId,
      mode,
      category: classification.category,
      severity: severity || classification.severity,
      recoverable: classification.recoverable,
      recommendedAction: classification.recommendedAction,
      reason,
      detail,
      active: true,
      enteredAt: nowIso(),
    };

    this.modes.push(record);
    this.emitEvent(record);
    return record;
  }

  list() {
    return this.modes.map((mode) => ({ ...mode, detail: { ...mode.detail } }));
  }

  finalReport({ summary = 'Task completed in degraded mode.', detail = {} } = {}) {
    const report = {
      type: 'recovery.partial_report_ready',
      taskId: this.taskId,
      status: this.modes.length > 0 ? 'degraded' : 'nominal',
      summary,
      degradedModes: this.list(),
      detail,
      createdAt: nowIso(),
    };

    this.emitEvent(report);
    return report;
  }
}
