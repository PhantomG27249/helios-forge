import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { HarnessClient } from '../src/harness/harnessClient.js';
import { createHarnessSidecar } from '../src/harness-sidecar/server.js';

async function writeTrace(workspaceRoot, taskId, events) {
  const traceDir = path.join(workspaceRoot, '.harness', 'traces', taskId);
  await mkdir(traceDir, { recursive: true });
  await writeFile(
    path.join(traceDir, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
}

async function withSidecarClient(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-trace-api-'));
  const sidecar = createHarnessSidecar({ workspaceRoot, port: 0 });
  await sidecar.start();
  const client = new HarnessClient({ baseUrl: sidecar.url });

  try {
    await testFn({ client, sidecar, workspaceRoot });
  } finally {
    client.close();
    await sidecar.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('trace API lists, reads, and prepares replay data through the harness client', async () => {
  await withSidecarClient(async ({ client, workspaceRoot }) => {
    await writeTrace(workspaceRoot, 'task_trace_api', [
      {
        type: 'task.started',
        taskId: 'task_trace_api',
        timestamp: '2026-06-07T10:00:00.000Z',
        summary: 'Trace API task',
        cost: { usd: 0.125 },
        context: { tokensUsed: 1200, maxTokens: 8000 },
      },
      {
        type: 'context_pack.created',
        taskId: 'task_trace_api',
        timestamp: '2026-06-07T10:01:00.000Z',
        tokensEstimated: 4096,
        excludedDueToBudget: 2,
      },
      {
        type: 'task.completed',
        taskId: 'task_trace_api',
        timestamp: '2026-06-07T10:02:00.000Z',
        status: 'completed',
      },
    ]);

    const traces = await client.listTraces();
    assert.deepEqual(traces.traces.map((trace) => trace.taskId), ['task_trace_api']);
    assert.equal(traces.traces[0].eventCount, 3);
    assert.equal(traces.traces[0].summary.latestState.status, 'completed');

    const detail = await client.getTrace('task_trace_api');
    assert.equal(detail.taskId, 'task_trace_api');
    assert.equal(detail.events.length, 3);
    assert.equal(detail.summary.eventCount, 3);

    const replay = await client.prepareTraceReplay('task_trace_api', { cursor: 1, limit: 1 });
    assert.equal(replay.taskId, 'task_trace_api');
    assert.deepEqual(replay.events.map((event) => event.type), ['context_pack.created']);
    assert.equal(replay.nextCursor, 2);
    assert.equal(replay.done, false);
    assert.equal(replay.summary.eventCount, 3);
  });
});

test('trace API rejects unsafe trace ids instead of treating them as paths', async () => {
  await withSidecarClient(async ({ client }) => {
    await assert.rejects(
      () => client.getTrace('../outside'),
      /Harness request failed: (400|500)/,
    );

    await assert.rejects(
      () => client.prepareTraceReplay('..\\outside'),
      /Harness request failed: (400|500)/,
    );
  });
});
