import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runPostTaskEvolutionOrchestrator } from '../src/harness-sidecar/meta/postTaskEvolutionOrchestrator.js';
import {
  ensurePostTaskEvolutionEmitted,
  wrapPostTaskEvolution,
} from '../src/harness-sidecar/meta/postTaskHookGuard.js';

async function makeWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-post-task-hook-guard-'));
  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  return workspaceRoot;
}

function recordingEmitEvent() {
  const events = [];
  const emitEvent = async (event) => {
    events.push(event);
  };
  return { events, emitEvent };
}

test('ensurePostTaskEvolutionEmitted calls runHooks and emits coordinated when hooks throw', async () => {
  const { events, emitEvent } = recordingEmitEvent();
  let hooksCalled = false;

  await assert.rejects(
    () => ensurePostTaskEvolutionEmitted({
      taskId: 'task-guard-throw',
      emitEvent,
      runHooks: async () => {
        hooksCalled = true;
        throw new Error('inner subsystem failed');
      },
    }),
    /inner subsystem failed/,
  );

  assert.equal(hooksCalled, true);
  const coordinated = events.find((event) => event.type === 'recursive_evolution.coordinated');
  assert.ok(coordinated, 'expected recursive_evolution.coordinated');
  assert.equal(coordinated.taskId, 'task-guard-throw');
  assert.equal(coordinated.coordinated, null);
  assert.equal(coordinated.reason, 'subsystem_error');
  assert.equal(coordinated.evidenceOnly, true);
  assert.equal(coordinated.canPromote, false);
});

test('wrapPostTaskEvolution emits coordinated with subsystem_error when runHooks throws', async () => {
  const { events, emitEvent } = recordingEmitEvent();
  const fixedNow = () => 1_000;

  const result = await wrapPostTaskEvolution({
    task: { taskId: 'task-wrap-throw', source: 'prompt_background' },
    emitEvent,
    now: fixedNow,
    runHooks: async () => {
      throw new Error('runFullRuntimeSubsystems failed');
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.skipReasons.includes('subsystem_error'), true);
  assert.ok(Array.isArray(result.spans));
  assert.equal(typeof result.durationMs, 'number');

  const coordinated = events.find((event) => event.type === 'recursive_evolution.coordinated');
  assert.ok(coordinated);
  assert.equal(coordinated.coordinated, null);
  assert.equal(coordinated.reason, 'subsystem_error');

  const failed = events.find((event) => event.type === 'recursive_evolution.failed');
  assert.ok(failed);
  assert.match(failed.reason, /runFullRuntimeSubsystems failed/);
});

test('wrapPostTaskEvolution records held_out_suite_missing skip reason without throwing', async () => {
  const workspaceRoot = await makeWorkspace();
  const { events, emitEvent } = recordingEmitEvent();

  try {
    const result = await wrapPostTaskEvolution({
      task: { taskId: 'task-wrap-skip', source: 'prompt_background' },
      emitEvent,
      runHooks: async ({ emitEvent: hookEmitEvent }) => runPostTaskEvolutionOrchestrator({
        workspaceRoot,
        harnessConfig: {
          productionCapabilities: {
            operatorDashboards: { enabled: true },
          },
        },
        task: { taskId: 'task-wrap-skip', source: 'prompt_background' },
        emitEvent: hookEmitEvent,
      }),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.skipReasons.includes('held_out_suite_missing'), true);
    assert.ok(events.some((event) => event.type === 'recursive_evolution.coordinated'));
    assert.ok(events.some((event) => event.type === 'replay.skipped' && event.reason === 'held_out_suite_missing'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('wrapPostTaskEvolution emits timing span metadata', async () => {
  const { events, emitEvent } = recordingEmitEvent();
  let tick = 0;
  const now = () => {
    tick += 100;
    return tick;
  };

  await wrapPostTaskEvolution({
    task: { taskId: 'task-timing' },
    emitEvent,
    now,
    runHooks: async () => ({ evidenceOnly: true, canPromote: false }),
  });

  const timing = events.find((event) => event.type === 'recursive_evolution.timing');
  assert.ok(timing);
  assert.equal(timing.taskId, 'task-timing');
  assert.equal(timing.durationMs, 300);
  assert.ok(Array.isArray(timing.spans));
  assert.equal(timing.spans[0].name, 'post_task_evolution_hooks');
});
