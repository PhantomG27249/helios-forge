export class DecisionLedger {
  constructor() {
    this.decisions = [];
    this.rejectedApproaches = [];
  }

  recordDecision(entry) {
    this.decisions.push({
      recordedAt: new Date().toISOString(),
      ...entry,
    });
  }

  recordRejectedApproach(entry) {
    this.rejectedApproaches.push({
      recordedAt: new Date().toISOString(),
      ...entry,
    });
  }

  snapshot() {
    return {
      decisions: [...this.decisions],
      rejectedApproaches: [...this.rejectedApproaches],
    };
  }
}
