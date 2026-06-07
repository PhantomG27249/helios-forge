function clonePlain(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function assertSafeId(kind, value) {
  const normalized = String(value || '').trim();
  if (
    !normalized
    || normalized.includes('\0')
    || normalized.includes('/')
    || normalized.includes('\\')
    || normalized.includes('..')
  ) {
    throw new Error(`Unsafe ${kind} id: ${value}`);
  }
  return normalized;
}

function addOptional(target, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}

function normalizeOptionalActorId(actorId) {
  if (actorId === undefined || actorId === null || actorId === '') {
    return undefined;
  }
  return assertSafeId('actor', actorId);
}

function normalizeOptionalCheckpointId(checkpointId) {
  if (checkpointId === undefined || checkpointId === null || checkpointId === '') {
    return undefined;
  }
  return assertSafeId('checkpoint', checkpointId);
}

export function createTaskCheckpointEvent({
  taskId,
  checkpointId,
  actorId,
  summary,
  state,
  timestamp,
} = {}) {
  const event = {
    type: 'task.checkpoint_created',
    taskId: assertSafeId('task', taskId),
    checkpointId: assertSafeId('checkpoint', checkpointId),
    actorId: assertSafeId('actor', actorId),
  };

  return addOptional(event, {
    summary,
    state: clonePlain(state),
    timestamp,
  });
}

export function createTaskInterruptedEvent({
  taskId,
  actorId,
  checkpointId,
  humanSteering = '',
  requestedActorId,
  reason,
  timestamp,
} = {}) {
  const event = {
    type: 'task.interrupted',
    taskId: assertSafeId('task', taskId),
    actorId: assertSafeId('actor', actorId),
    status: 'interrupted',
    humanSteering,
  };

  return addOptional(event, {
    checkpointId: normalizeOptionalCheckpointId(checkpointId),
    requestedActorId: normalizeOptionalActorId(requestedActorId),
    reason,
    timestamp,
  });
}

export function createTaskResumeRequestedEvent({
  taskId,
  actorId,
  checkpointId,
  requestedActorId,
  humanSteering = '',
  timestamp,
} = {}) {
  const event = {
    type: 'task.resume_requested',
    taskId: assertSafeId('task', taskId),
    actorId: assertSafeId('actor', actorId),
    status: 'resume_requested',
    humanSteering,
  };

  return addOptional(event, {
    checkpointId: normalizeOptionalCheckpointId(checkpointId),
    requestedActorId: normalizeOptionalActorId(requestedActorId),
    timestamp,
  });
}

export function createTaskResumedEvent({
  taskId,
  actorId,
  checkpointId,
  timestamp,
} = {}) {
  const event = {
    type: 'task.resumed',
    taskId: assertSafeId('task', taskId),
    actorId: assertSafeId('actor', actorId),
    status: 'resumed',
  };

  return addOptional(event, {
    checkpointId: normalizeOptionalCheckpointId(checkpointId),
    timestamp,
  });
}

function emptyState(taskId) {
  return {
    taskId,
    resumeStatus: 'ready',
    currentCheckpoint: null,
    humanSteering: '',
    requestedActorId: null,
    interruptedBy: null,
    interruptedAt: null,
    resumeRequestedBy: null,
    resumeRequestedAt: null,
    resumedBy: null,
    resumedAt: null,
  };
}

function checkpointFrom(event) {
  return addOptional({
    checkpointId: event.checkpointId,
    actorId: event.actorId,
  }, {
    summary: event.summary,
    state: clonePlain(event.state),
    timestamp: event.timestamp,
  });
}

export class TaskInterruptRegistry {
  constructor({ tasks = [] } = {}) {
    this.tasks = new Map();
    for (const task of tasks) {
      const taskId = assertSafeId('task', task.taskId);
      this.tasks.set(taskId, {
        ...emptyState(taskId),
        ...clonePlain(task),
        taskId,
      });
    }
  }

  static fromJSON(snapshot = {}) {
    return new TaskInterruptRegistry({ tasks: snapshot.tasks || [] });
  }

  ensure(taskId) {
    const safeTaskId = assertSafeId('task', taskId);
    if (!this.tasks.has(safeTaskId)) {
      this.tasks.set(safeTaskId, emptyState(safeTaskId));
    }
    return this.tasks.get(safeTaskId);
  }

  applyEvent(event = {}) {
    const taskId = assertSafeId('task', event.taskId);
    const state = this.ensure(taskId);

    switch (event.type) {
      case 'task.checkpoint_created':
        assertSafeId('actor', event.actorId);
        assertSafeId('checkpoint', event.checkpointId);
        state.currentCheckpoint = checkpointFrom(event);
        break;
      case 'task.interrupted':
        assertSafeId('actor', event.actorId);
        state.resumeStatus = 'interrupted';
        state.humanSteering = event.humanSteering || '';
        state.requestedActorId = normalizeOptionalActorId(event.requestedActorId) || null;
        state.interruptedBy = event.actorId;
        state.interruptedAt = event.timestamp || null;
        if (event.checkpointId) {
          state.currentCheckpoint = state.currentCheckpoint?.checkpointId === event.checkpointId
            ? state.currentCheckpoint
            : { checkpointId: normalizeOptionalCheckpointId(event.checkpointId) };
        }
        break;
      case 'task.resume_requested':
        assertSafeId('actor', event.actorId);
        state.resumeStatus = 'resume_requested';
        state.humanSteering = event.humanSteering || state.humanSteering;
        state.requestedActorId = normalizeOptionalActorId(event.requestedActorId) || state.requestedActorId;
        state.resumeRequestedBy = event.actorId;
        state.resumeRequestedAt = event.timestamp || null;
        if (event.checkpointId) {
          state.currentCheckpoint = state.currentCheckpoint?.checkpointId === event.checkpointId
            ? state.currentCheckpoint
            : { checkpointId: normalizeOptionalCheckpointId(event.checkpointId) };
        }
        break;
      case 'task.resumed':
        assertSafeId('actor', event.actorId);
        state.resumeStatus = 'resumed';
        state.resumedBy = event.actorId;
        state.resumedAt = event.timestamp || null;
        if (event.checkpointId) {
          state.currentCheckpoint = state.currentCheckpoint?.checkpointId === event.checkpointId
            ? state.currentCheckpoint
            : { checkpointId: normalizeOptionalCheckpointId(event.checkpointId) };
        }
        break;
      default:
        throw new Error(`Unsupported task interrupt event type: ${event.type}`);
    }

    return this.get(taskId);
  }

  get(taskId) {
    const safeTaskId = assertSafeId('task', taskId);
    return clonePlain(this.tasks.get(safeTaskId) || null);
  }

  toJSON() {
    return {
      tasks: [...this.tasks.values()].map((task) => clonePlain(task)),
    };
  }
}

export function summarizeInterruptState(state = null) {
  if (!state) {
    return null;
  }

  return {
    taskId: state.taskId,
    resumeStatus: state.resumeStatus,
    checkpointId: state.currentCheckpoint?.checkpointId || null,
    checkpointSummary: state.currentCheckpoint?.summary || null,
    humanSteering: state.humanSteering || '',
    requestedActorId: state.requestedActorId || null,
    isInterrupted: state.resumeStatus === 'interrupted',
    isResumeRequested: state.resumeStatus === 'resume_requested',
    isResumed: state.resumeStatus === 'resumed',
  };
}
