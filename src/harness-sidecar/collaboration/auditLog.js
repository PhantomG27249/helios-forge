export class AuditLog {
  constructor() {
    this.records = [];
  }

  record({ actor, target, operation, reason, taskId = null }) {
    const entry = {
      auditId: `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      actor,
      target,
      operation,
      reason,
      taskId,
      timestamp: new Date().toISOString(),
    };
    this.records.push(entry);
    return entry;
  }

  entries() {
    return [...this.records];
  }
}
