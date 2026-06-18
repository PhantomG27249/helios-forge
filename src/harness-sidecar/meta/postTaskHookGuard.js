const SKIP_REASONS = {
  HELD_OUT_SUITE_MISSING: 'held_out_suite_missing',
  SUBSYSTEM_ERROR: 'subsystem_error',
};

function resolveNow(now) {
  return typeof now === 'function' ? now() : Date.now();
}

function createTrackedEmitEvent({ emitEvent, onCoordinated, onSkipReason } = {}) {
  let coordinatedEmitted = false;

  const trackedEmitEvent = async (event = {}) => {
    if (event.type === 'recursive_evolution.coordinated') {
      coordinatedEmitted = true;
      if (typeof onCoordinated === 'function') {
        onCoordinated(event);
      }
    }

    if (event.reason === SKIP_REASONS.HELD_OUT_SUITE_MISSING
      || event.type === 'replay.skipped' && event.reason === SKIP_REASONS.HELD_OUT_SUITE_MISSING) {
      if (typeof onSkipReason === 'function') {
        onSkipReason(SKIP_REASONS.HELD_OUT_SUITE_MISSING);
      }
    }

    if (typeof emitEvent === 'function') {
      return emitEvent(event);
    }
    return undefined;
  };

  return {
    emitEvent: trackedEmitEvent,
    wasCoordinatedEmitted: () => coordinatedEmitted,
  };
}

export async function ensurePostTaskEvolutionEmitted({
  taskId,
  emitEvent,
  runHooks,
} = {}) {
  if (typeof runHooks !== 'function') {
    throw new Error('runHooks is required');
  }

  const { emitEvent: trackedEmitEvent, wasCoordinatedEmitted } = createTrackedEmitEvent({
    emitEvent,
  });

  let hookError = null;
  try {
    return await runHooks({ emitEvent: trackedEmitEvent });
  } catch (error) {
    hookError = error;
    throw error;
  } finally {
    if (!wasCoordinatedEmitted()) {
      await trackedEmitEvent({
        type: 'recursive_evolution.coordinated',
        taskId,
        coordinated: null,
        reason: hookError ? SKIP_REASONS.SUBSYSTEM_ERROR : undefined,
        evidenceOnly: true,
        canPromote: false,
      });
    }
  }
}

export async function wrapPostTaskEvolution({
  task = {},
  emitEvent,
  runHooks,
  now,
} = {}) {
  if (typeof runHooks !== 'function') {
    throw new Error('runHooks is required');
  }

  const taskId = task.taskId ?? task.id ?? null;
  const startedAt = resolveNow(now);
  const skipReasons = [];
  const spans = [];

  const recordSkipReason = (reason) => {
    if (!skipReasons.includes(reason)) {
      skipReasons.push(reason);
    }
  };

  const { emitEvent: trackedEmitEvent, wasCoordinatedEmitted } = createTrackedEmitEvent({
    emitEvent,
    onSkipReason: recordSkipReason,
  });

  const baseResult = {
    evidenceOnly: true,
    canPromote: false,
    skipReasons,
    spans,
    durationMs: 0,
    coordinatedEmitted: false,
    status: 'completed',
  };

  let hookError = null;
  let hookResults = null;

  try {
    const hookStartedAt = resolveNow(now);
    hookResults = await runHooks({ emitEvent: trackedEmitEvent, task });
    spans.push({
      name: 'post_task_evolution_hooks',
      durationMs: resolveNow(now) - hookStartedAt,
    });

    for (const entry of hookResults?.replay?.skipped || []) {
      if (entry?.reason) {
        recordSkipReason(entry.reason);
      }
    }
  } catch (error) {
    hookError = error;
    baseResult.status = 'failed';
    recordSkipReason(SKIP_REASONS.SUBSYSTEM_ERROR);

    await trackedEmitEvent({
      type: 'recursive_evolution.failed',
      taskId,
      reason: error.message,
      skipReason: SKIP_REASONS.SUBSYSTEM_ERROR,
      evidenceOnly: true,
      canPromote: false,
    });
  } finally {
    if (!wasCoordinatedEmitted()) {
      await trackedEmitEvent({
        type: 'recursive_evolution.coordinated',
        taskId,
        coordinated: null,
        reason: hookError ? SKIP_REASONS.SUBSYSTEM_ERROR : undefined,
        evidenceOnly: true,
        canPromote: false,
      });
    }

    baseResult.durationMs = resolveNow(now) - startedAt;
    baseResult.coordinatedEmitted = wasCoordinatedEmitted();

    await trackedEmitEvent({
      type: 'recursive_evolution.timing',
      taskId,
      durationMs: baseResult.durationMs,
      spans,
      evidenceOnly: true,
      canPromote: false,
    });
  }

  return {
    ...baseResult,
    ...(hookResults && typeof hookResults === 'object' ? hookResults : {}),
    skipReasons,
    spans,
    durationMs: baseResult.durationMs,
    coordinatedEmitted: baseResult.coordinatedEmitted,
    status: baseResult.status,
  };
}
