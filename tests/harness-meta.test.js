import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { generateCandidateChange } from '../src/harness-sidecar/meta/candidateGenerator.js';
import { recordCandidateRun } from '../src/harness-sidecar/meta/candidateRunner.js';
import { HarnessOptimizer } from '../src/harness-sidecar/meta/harnessOptimizer.js';
import { ParetoTracker } from '../src/harness-sidecar/meta/paretoTracker.js';
import { inspectTrace } from '../src/harness-sidecar/meta/traceInspector.js';

test('trace inspector summarizes failure and budget events from trace jsonl', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-meta-'));
  const traceDir = path.join(workspaceRoot, '.harness', 'traces', 'task_meta');
  await mkdir(traceDir, { recursive: true });
  await writeFile(path.join(traceDir, 'events.jsonl'), [
    JSON.stringify({ type: 'recovery.event', category: 'no_progress_loop' }),
    JSON.stringify({ type: 'budget.gate', percent: 90 }),
  ].join('\n'));

  try {
    const summary = await inspectTrace({ traceDir });
    assert.equal(summary.recoveryEvents.length, 1);
    assert.equal(summary.budgetGates.length, 1);
    assert.equal(summary.failureModes.includes('no_progress_loop'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('candidate generator proposes approval-required harness changes', () => {
  const candidate = generateCandidateChange({
    traceSummary: {
      failureModes: ['no_progress_loop'],
      budgetGates: [{ percent: 90 }],
    },
    target: 'retrieval_policy',
  });

  assert.match(candidate.candidateId, /^cand_/);
  assert.equal(candidate.target, 'retrieval_policy');
  assert.equal(candidate.requiresApproval, true);
  assert.match(candidate.rationale, /no_progress_loop/);
});

test('pareto tracker keeps non-dominated candidates', () => {
  const tracker = new ParetoTracker();
  tracker.add({ candidateId: 'slow-good', quality: 0.9, cost: 0.8, latency: 0.8, safety: 0.9 });
  tracker.add({ candidateId: 'fast-good', quality: 0.9, cost: 0.4, latency: 0.4, safety: 0.9 });
  tracker.add({ candidateId: 'cheap-worse', quality: 0.5, cost: 0.2, latency: 0.2, safety: 0.8 });

  const frontierIds = tracker.getFrontier().map((candidate) => candidate.candidateId);
  assert.equal(frontierIds.includes('slow-good'), false);
  assert.equal(frontierIds.includes('fast-good'), true);
  assert.equal(frontierIds.includes('cheap-worse'), true);
});

test('harness optimizer proposes but does not apply candidate changes', async () => {
  const run = recordCandidateRun({
    candidateId: 'cand_test',
    smokePassed: true,
    metrics: { quality: 0.7, cost: 0.3, latency: 0.2, safety: 0.9 },
  });
  const optimizer = new HarnessOptimizer();
  const proposal = optimizer.propose({
    traceSummary: { failureModes: ['tool_timeout'], budgetGates: [] },
    target: 'tool_policy',
    candidateRun: run,
  });

  assert.equal(proposal.status, 'approval_required');
  assert.equal(proposal.applied, false);
  assert.equal(proposal.candidateRun.smokePassed, true);
});
