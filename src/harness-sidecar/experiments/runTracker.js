let runCounter = 0;

function makeRunId() {
  runCounter += 1;
  return `run_${String(runCounter).padStart(4, '0')}`;
}

export class RunTracker {
  constructor() {
    this.runs = new Map();
  }

  startRun({ experimentId, command, artifacts = [] }) {
    const run = {
      runId: makeRunId(),
      experimentId,
      command,
      artifacts,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    this.runs.set(run.runId, run);
    return run;
  }

  finishRun({ runId, exitCode, metrics = {}, artifacts = [] }) {
    const existing = this.runs.get(runId);
    if (!existing) throw new Error(`Unknown run: ${runId}`);

    const finished = {
      ...existing,
      exitCode,
      metrics,
      artifacts: [...existing.artifacts, ...artifacts],
      status: exitCode === 0 ? 'passed' : 'failed',
      finishedAt: new Date().toISOString(),
    };
    this.runs.set(runId, finished);
    return finished;
  }

  listRuns(experimentId) {
    return [...this.runs.values()].filter((run) => run.experimentId === experimentId);
  }
}
