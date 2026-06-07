function mergeState(current, event) {
  if (event.state && typeof event.state === 'object') {
    return { ...current, ...event.state };
  }
  if (event.patch && typeof event.patch === 'object') {
    return { ...current, ...event.patch };
  }
  if (event.status) {
    return { ...current, status: event.status };
  }
  return current;
}

function collectArtifacts(event) {
  if (Array.isArray(event.artifacts)) {
    return event.artifacts;
  }
  if (event.artifact) {
    return [event.artifact];
  }
  return [];
}

function collectFailure(event) {
  if (event.failure) {
    return event.failure;
  }
  if (event.type?.includes('failure') || event.type === 'recovery.event') {
    return {
      category: event.category || event.reason || event.type,
      message: event.message || event.summary,
    };
  }
  return null;
}

function collectDecision(event) {
  if (event.decision) {
    return event.decision;
  }
  if (event.type?.includes('decision')) {
    return {
      conclusion: event.conclusion || event.status,
      reasons: event.reasons || [],
    };
  }
  return null;
}

export function compactTraceEvents(events = []) {
  const countsByType = {};
  const artifacts = [];
  const failures = [];
  const decisions = [];
  let latestState = {};
  let task = {};
  let taskId = null;

  for (const event of events) {
    if (!event || typeof event !== 'object') {
      continue;
    }

    const type = event.type || 'unknown';
    countsByType[type] = (countsByType[type] || 0) + 1;
    taskId = event.taskId || taskId;

    if (type === 'task.started') {
      task = {
        ...task,
        taskId: event.taskId,
        summary: event.summary,
        task: event.task,
        mode: event.mode,
        source: event.source,
      };
      latestState = mergeState(latestState, { status: 'running' });
    }

    latestState = mergeState(latestState, event);
    artifacts.push(...collectArtifacts(event));

    const failure = collectFailure(event);
    if (failure) {
      failures.push(failure);
    }

    const decision = collectDecision(event);
    if (decision) {
      decisions.push(decision);
    }
  }

  return {
    taskId,
    task,
    eventCount: events.length,
    countsByType,
    artifacts,
    failures,
    decisions,
    latestState,
  };
}
