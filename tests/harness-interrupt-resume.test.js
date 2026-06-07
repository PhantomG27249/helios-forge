import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TaskInterruptRegistry,
  createTaskCheckpointEvent,
  createTaskInterruptedEvent,
  createTaskResumeRequestedEvent,
  createTaskResumedEvent,
  summarizeInterruptState,
} from '../src/harness-sidecar/core/taskInterrupts.js';

const TIMESTAMP = '2026-06-07T18:00:00.000Z';

test('interrupt resume event factories create deterministic task lifecycle events', () => {
  const checkpoint = createTaskCheckpointEvent({
    taskId: 'task_interrupt_001',
    checkpointId: 'checkpoint_review',
    actorId: 'worker_alpha',
    summary: 'Implementation paused before server wiring.',
    state: { phase: 'core' },
    timestamp: TIMESTAMP,
  });
  assert.deepEqual(checkpoint, {
    type: 'task.checkpoint_created',
    taskId: 'task_interrupt_001',
    checkpointId: 'checkpoint_review',
    actorId: 'worker_alpha',
    summary: 'Implementation paused before server wiring.',
    state: { phase: 'core' },
    timestamp: TIMESTAMP,
  });

  const interrupted = createTaskInterruptedEvent({
    taskId: 'task_interrupt_001',
    actorId: 'human_operator',
    checkpointId: 'checkpoint_review',
    humanSteering: 'Pause here and let worker_beta resume with the new constraint.',
    requestedActorId: 'worker_beta',
    reason: 'needs_human_steering',
    timestamp: TIMESTAMP,
  });
  assert.equal(interrupted.type, 'task.interrupted');
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.requestedActorId, 'worker_beta');
  assert.equal(interrupted.humanSteering, 'Pause here and let worker_beta resume with the new constraint.');

  const resumeRequested = createTaskResumeRequestedEvent({
    taskId: 'task_interrupt_001',
    actorId: 'human_operator',
    checkpointId: 'checkpoint_review',
    requestedActorId: 'worker_beta',
    humanSteering: 'Resume from checkpoint_review.',
    timestamp: TIMESTAMP,
  });
  assert.equal(resumeRequested.type, 'task.resume_requested');
  assert.equal(resumeRequested.status, 'resume_requested');

  const resumed = createTaskResumedEvent({
    taskId: 'task_interrupt_001',
    actorId: 'worker_beta',
    checkpointId: 'checkpoint_review',
    timestamp: TIMESTAMP,
  });
  assert.deepEqual(resumed, {
    type: 'task.resumed',
    taskId: 'task_interrupt_001',
    actorId: 'worker_beta',
    checkpointId: 'checkpoint_review',
    status: 'resumed',
    timestamp: TIMESTAMP,
  });
});

test('interrupt event factories reject task and actor ids unsafe for persistence paths', () => {
  assert.throws(
    () => createTaskInterruptedEvent({
      taskId: '../task_escape',
      actorId: 'human_operator',
      humanSteering: 'stop',
      timestamp: TIMESTAMP,
    }),
    /unsafe task id/i,
  );

  assert.throws(
    () => createTaskResumedEvent({
      taskId: 'task_safe',
      actorId: 'worker/beta',
      timestamp: TIMESTAMP,
    }),
    /unsafe actor id/i,
  );
});

test('registry records interrupt checkpoint resume state and exports a persistable snapshot', () => {
  const registry = new TaskInterruptRegistry();

  registry.applyEvent(createTaskCheckpointEvent({
    taskId: 'task_interrupt_001',
    checkpointId: 'checkpoint_review',
    actorId: 'worker_alpha',
    summary: 'Core module ready for handoff.',
    state: { phase: 'tests_red' },
    timestamp: '2026-06-07T18:00:00.000Z',
  }));
  registry.applyEvent(createTaskInterruptedEvent({
    taskId: 'task_interrupt_001',
    actorId: 'human_operator',
    checkpointId: 'checkpoint_review',
    humanSteering: 'Resume with worker_beta and preserve owned-file scope.',
    requestedActorId: 'worker_beta',
    reason: 'ownership_handoff',
    timestamp: '2026-06-07T18:01:00.000Z',
  }));
  registry.applyEvent(createTaskResumeRequestedEvent({
    taskId: 'task_interrupt_001',
    actorId: 'human_operator',
    checkpointId: 'checkpoint_review',
    requestedActorId: 'worker_beta',
    humanSteering: 'Continue from checkpoint_review.',
    timestamp: '2026-06-07T18:02:00.000Z',
  }));

  const state = registry.get('task_interrupt_001');
  assert.equal(state.taskId, 'task_interrupt_001');
  assert.equal(state.resumeStatus, 'resume_requested');
  assert.equal(state.currentCheckpoint.checkpointId, 'checkpoint_review');
  assert.equal(state.currentCheckpoint.summary, 'Core module ready for handoff.');
  assert.equal(state.humanSteering, 'Continue from checkpoint_review.');
  assert.equal(state.requestedActorId, 'worker_beta');

  const snapshot = registry.toJSON();
  assert.deepEqual(snapshot, {
    tasks: [{
      taskId: 'task_interrupt_001',
      resumeStatus: 'resume_requested',
      currentCheckpoint: {
        checkpointId: 'checkpoint_review',
        actorId: 'worker_alpha',
        summary: 'Core module ready for handoff.',
        state: { phase: 'tests_red' },
        timestamp: '2026-06-07T18:00:00.000Z',
      },
      humanSteering: 'Continue from checkpoint_review.',
      requestedActorId: 'worker_beta',
      interruptedBy: 'human_operator',
      interruptedAt: '2026-06-07T18:01:00.000Z',
      resumeRequestedBy: 'human_operator',
      resumeRequestedAt: '2026-06-07T18:02:00.000Z',
      resumedBy: null,
      resumedAt: null,
    }],
  });

  const restored = TaskInterruptRegistry.fromJSON(snapshot);
  assert.deepEqual(restored.get('task_interrupt_001'), state);

  registry.applyEvent(createTaskResumedEvent({
    taskId: 'task_interrupt_001',
    actorId: 'worker_beta',
    checkpointId: 'checkpoint_review',
    timestamp: '2026-06-07T18:03:00.000Z',
  }));
  assert.equal(registry.get('task_interrupt_001').resumeStatus, 'resumed');
  assert.equal(registry.get('task_interrupt_001').resumedBy, 'worker_beta');
});

test('registry rejects replayed checkpoint events with unsafe checkpoint ids', () => {
  const registry = new TaskInterruptRegistry();

  assert.throws(
    () => registry.applyEvent({
      type: 'task.checkpoint_created',
      taskId: 'task_interrupt_001',
      checkpointId: '../escape',
      actorId: 'worker_alpha',
    }),
    /unsafe checkpoint id/i,
  );
});

test('summarizeInterruptState returns UI ready interrupt status without exposing mutable state', () => {
  const registry = new TaskInterruptRegistry();
  registry.applyEvent(createTaskCheckpointEvent({
    taskId: 'task_interrupt_001',
    checkpointId: 'checkpoint_review',
    actorId: 'worker_alpha',
    summary: 'Ready to resume from test checkpoint.',
    timestamp: TIMESTAMP,
  }));
  registry.applyEvent(createTaskInterruptedEvent({
    taskId: 'task_interrupt_001',
    actorId: 'human_operator',
    checkpointId: 'checkpoint_review',
    humanSteering: 'Ask worker_beta to continue.',
    requestedActorId: 'worker_beta',
    timestamp: TIMESTAMP,
  }));

  const summary = summarizeInterruptState(registry.get('task_interrupt_001'));
  assert.deepEqual(summary, {
    taskId: 'task_interrupt_001',
    resumeStatus: 'interrupted',
    checkpointId: 'checkpoint_review',
    checkpointSummary: 'Ready to resume from test checkpoint.',
    humanSteering: 'Ask worker_beta to continue.',
    requestedActorId: 'worker_beta',
    isInterrupted: true,
    isResumeRequested: false,
    isResumed: false,
  });

  summary.resumeStatus = 'mutated';
  assert.equal(registry.get('task_interrupt_001').resumeStatus, 'interrupted');
});
