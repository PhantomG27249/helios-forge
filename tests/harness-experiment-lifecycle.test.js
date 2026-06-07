import assert from 'node:assert/strict';
import { test } from 'node:test';

import { writeExperimentDecision } from '../src/harness-sidecar/experiments/decisionWriter.js';
import { ExperimentQueue } from '../src/harness-sidecar/experiments/experimentQueue.js';
import { compileExperimentReport } from '../src/harness-sidecar/experiments/experimentReports.js';
import { classifyNoise } from '../src/harness-sidecar/experiments/noiseGate.js';
import { RunTracker } from '../src/harness-sidecar/experiments/runTracker.js';

test('experiment queue holds proposals until approval and budget are present', () => {
  const queue = new ExperimentQueue();
  const proposal = {
    experimentId: 'EXP0001',
    status: 'approval_required',
    budget: { maxWallMinutes: 5 },
    commands: ['npm test'],
  };

  const queued = queue.enqueue(proposal);
  const blocked = queue.claimNext({ approvals: [], budget: { remainingWallMinutes: 10 } });
  const claimed = queue.claimNext({
    approvals: [{ experimentId: 'EXP0001', choice: 'approve' }],
    budget: { remainingWallMinutes: 10 },
  });

  assert.equal(queued.status, 'queued');
  assert.equal(blocked, null);
  assert.equal(claimed.experimentId, 'EXP0001');
  assert.equal(claimed.status, 'running');
});

test('run tracker records lifecycle and metric artifacts', () => {
  const tracker = new RunTracker();

  const run = tracker.startRun({
    experimentId: 'EXP0002',
    command: 'npm test',
    artifacts: [{ artifactId: 'art_log', type: 'verifier_log' }],
  });
  const finished = tracker.finishRun({
    runId: run.runId,
    exitCode: 0,
    metrics: { passRate: 1, cost: 0.4 },
  });

  assert.match(run.runId, /^run_/);
  assert.equal(finished.status, 'passed');
  assert.equal(finished.metrics.passRate, 1);
  assert.equal(tracker.listRuns('EXP0002').length, 1);
});

test('noise gate separates meaningful metric changes from noisy deltas', () => {
  const decision = classifyNoise({
    deltas: { passRate: 0.01, cost: -0.2, latency: 0.001 },
    thresholds: { passRate: 0.03, cost: 0.05, latency: 0.01 },
  });

  assert.deepEqual(decision.noisyMetrics.sort(), ['latency', 'passRate']);
  assert.deepEqual(decision.meaningfulMetrics, ['cost']);
  assert.equal(decision.hasMeaningfulChange, true);
});

test('decision writer links hypothesis runs metrics and conclusion', () => {
  const decision = writeExperimentDecision({
    experiment: { experimentId: 'EXP0003', hypothesis: 'Retries improve pass rate.' },
    runs: [{ runId: 'run_1', status: 'passed' }],
    metricComparison: { deltas: { passRate: 0.1 }, noisyMetrics: [] },
    noiseDecision: { hasMeaningfulChange: true, meaningfulMetrics: ['passRate'] },
    artifacts: [{ artifactId: 'art_report', type: 'experiment_report' }],
  });

  assert.match(decision.decisionId, /^decision_/);
  assert.equal(decision.conclusion, 'accept');
  assert.deepEqual(decision.evidence.runIds, ['run_1']);
  assert.deepEqual(decision.evidence.artifactIds, ['art_report']);
});

test('experiment report emits hypothesis run metric and decision sections', () => {
  const markdown = compileExperimentReport({
    experiment: { experimentId: 'EXP0004', hypothesis: 'Context packing helps.' },
    runs: [{ runId: 'run_2', status: 'passed', command: 'npm test' }],
    metricComparison: { deltas: { quality: 0.2 }, noisyMetrics: [] },
    decision: { conclusion: 'accept', reasons: ['meaningful_metric_change'] },
  });

  assert.match(markdown, /## Hypothesis/);
  assert.match(markdown, /run_2/);
  assert.match(markdown, /quality/);
  assert.match(markdown, /accept/);
});
