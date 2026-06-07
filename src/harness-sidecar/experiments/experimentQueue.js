export class ExperimentQueue {
  constructor() {
    this.items = [];
  }

  enqueue(experiment) {
    const queued = {
      ...experiment,
      status: 'queued',
      queuedAt: new Date().toISOString(),
    };
    this.items.push(queued);
    return queued;
  }

  claimNext({ approvals = [], budget = {} } = {}) {
    const index = this.items.findIndex((experiment) => canRunExperiment(experiment, approvals, budget));
    if (index === -1) return null;

    const [experiment] = this.items.splice(index, 1);
    return {
      ...experiment,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
  }

  list() {
    return [...this.items];
  }
}

function canRunExperiment(experiment, approvals, budget) {
  const approved = approvals.some((approval) => (
    approval.experimentId === experiment.experimentId && approval.choice === 'approve'
  ));
  if (!approved) return false;

  const requestedMinutes = experiment.budget?.maxWallMinutes || 0;
  const remainingMinutes = budget.remainingWallMinutes ?? Number.POSITIVE_INFINITY;
  return requestedMinutes <= remainingMinutes;
}
