const TOOL_CALL_GATES = [
  { percent: 50, action: 'progress_summary' },
  { percent: 75, action: 'orchestrator_review' },
  { percent: 90, action: 'approval_required' },
  { percent: 100, action: 'hard_stop' },
];

export class BudgetManager {
  constructor({
    taskId,
    limits = {},
    emitEvent = () => {},
  }) {
    this.taskId = taskId;
    this.limits = {
      maxToolCalls: limits.maxToolCalls || 20,
      maxWallMinutes: limits.maxWallMinutes || 15,
    };
    this.used = {
      toolCalls: 0,
      verifierCalls: 0,
      wallMinutes: 0,
      artifacts: 0,
    };
    this.emitEvent = emitEvent;
    this.emittedGates = new Set();
  }

  recordUsage({ toolCalls = 0, verifierCalls = 0, wallMinutes = 0, artifacts = 0 }) {
    this.used.toolCalls += toolCalls;
    this.used.verifierCalls += verifierCalls;
    this.used.wallMinutes += wallMinutes;
    this.used.artifacts += artifacts;

    const state = this.getState();
    this.emitEvent({
      type: 'budget.updated',
      taskId: this.taskId,
      budget: state,
    });

    for (const gate of TOOL_CALL_GATES) {
      if (state.percentUsed.toolCalls >= gate.percent && !this.emittedGates.has(gate.percent)) {
        this.emittedGates.add(gate.percent);
        this.emitEvent({
          type: 'budget.gate',
          taskId: this.taskId,
          percent: gate.percent,
          action: gate.action,
          budget: state,
        });
      }
    }

    return state;
  }

  getState() {
    const toolCallPercent = Math.min(
      100,
      Math.round((this.used.toolCalls / this.limits.maxToolCalls) * 100),
    );

    return {
      taskId: this.taskId,
      limits: { ...this.limits },
      used: { ...this.used },
      percentUsed: {
        toolCalls: toolCallPercent,
      },
    };
  }
}
