import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { listTraces, readTrace, replayTrace } from '../src/harness-sidecar/core/traceReader.js';

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'harness-trace-reader-'));
  try {
    await testFn({ workspaceRoot });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeTrace(workspaceRoot, taskId, lines) {
  const traceDir = path.join(workspaceRoot, '.harness', 'traces', taskId);
  await mkdir(traceDir, { recursive: true });
  await writeFile(path.join(traceDir, 'events.jsonl'), `${lines.join('\n')}\n`, 'utf8');
}

function event(overrides) {
  return JSON.stringify({
    taskId: overrides.taskId || 'task_a',
    type: overrides.type,
    timestamp: overrides.timestamp,
    ...overrides,
  });
}

test('listTraces catalogs trace metadata and compact summaries', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    await writeTrace(workspaceRoot, 'task_a', [
      event({
        taskId: 'task_a',
        type: 'task.started',
        timestamp: '2026-06-07T10:00:00.000Z',
        task: 'catalog the traces',
        summary: 'Catalog traces',
      }),
      event({
        taskId: 'task_a',
        type: 'task_state.updated',
        timestamp: '2026-06-07T10:01:00.000Z',
        status: 'running',
      }),
      event({
        taskId: 'task_a',
        type: 'task.completed',
        timestamp: '2026-06-07T10:02:00.000Z',
        status: 'completed',
      }),
    ]);
    await writeTrace(workspaceRoot, 'task_b', [
      event({
        taskId: 'task_b',
        type: 'task.started',
        timestamp: '2026-06-07T09:00:00.000Z',
        task: 'older trace',
      }),
    ]);

    const traces = await listTraces({ workspaceRoot });

    assert.deepEqual(
      traces.map((trace) => trace.taskId),
      ['task_a', 'task_b'],
    );
    assert.equal(traces[0].eventCount, 3);
    assert.equal(traces[0].firstTimestamp, '2026-06-07T10:00:00.000Z');
    assert.equal(traces[0].lastTimestamp, '2026-06-07T10:02:00.000Z');
    assert.deepEqual(traces[0].latestTaskEvent, {
      type: 'task.completed',
      status: 'completed',
      timestamp: '2026-06-07T10:02:00.000Z',
    });
    assert.equal(traces[0].summary.task.task, 'catalog the traces');
    assert.equal(traces[0].summary.latestState.status, 'completed');
  });
});

test('readTrace returns ordered parsed events, compacted summary, and parse errors', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    await writeTrace(workspaceRoot, 'task_bad_line', [
      event({
        taskId: 'task_bad_line',
        type: 'task.started',
        timestamp: '2026-06-07T11:00:00.000Z',
      }),
      '',
      '{ definitely not json',
      event({
        taskId: 'task_bad_line',
        type: 'task_state.updated',
        timestamp: '2026-06-07T11:01:00.000Z',
        status: 'waiting',
      }),
    ]);

    const trace = await readTrace({ workspaceRoot, taskId: 'task_bad_line' });

    assert.deepEqual(
      trace.events.map((traceEvent) => traceEvent.type),
      ['task.started', 'task_state.updated'],
    );
    assert.equal(trace.summary.eventCount, 2);
    assert.equal(trace.summary.latestState.status, 'waiting');
    assert.equal(trace.parseErrors.length, 1);
    assert.equal(trace.parseErrors[0].lineNumber, 3);
    assert.match(trace.parseErrors[0].message, /JSON/);
  });
});

test('replayTrace pages through events with a numeric cursor and limit', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    await writeTrace(workspaceRoot, 'task_replay', [
      event({ taskId: 'task_replay', type: 'task.started', timestamp: '2026-06-07T12:00:00.000Z' }),
      event({ taskId: 'task_replay', type: 'step.one', timestamp: '2026-06-07T12:01:00.000Z' }),
      event({ taskId: 'task_replay', type: 'step.two', timestamp: '2026-06-07T12:02:00.000Z' }),
    ]);

    const firstPage = await replayTrace({ workspaceRoot, taskId: 'task_replay', limit: 2 });
    const secondPage = await replayTrace({
      workspaceRoot,
      taskId: 'task_replay',
      cursor: firstPage.nextCursor,
      limit: 2,
    });

    assert.deepEqual(
      firstPage.events.map((traceEvent) => traceEvent.type),
      ['task.started', 'step.one'],
    );
    assert.equal(firstPage.nextCursor, 2);
    assert.equal(firstPage.done, false);
    assert.deepEqual(
      secondPage.events.map((traceEvent) => traceEvent.type),
      ['step.two'],
    );
    assert.equal(secondPage.nextCursor, 3);
    assert.equal(secondPage.done, true);
  });
});

test('readTrace and replayTrace reject task ids that escape the trace root', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    await assert.rejects(
      readTrace({ workspaceRoot, taskId: '../outside' }),
      /unsafe trace task id/i,
    );

    await assert.rejects(
      replayTrace({ workspaceRoot, taskId: '..\\outside' }),
      /unsafe trace task id/i,
    );
  });
});
