function clampConcurrency(concurrency, attemptCount) {
  if (attemptCount <= 0) return 0;
  const normalized = Math.floor(Number(concurrency));
  if (!Number.isFinite(normalized)) return 1;
  return Math.max(1, Math.min(attemptCount, normalized));
}

function failureRecord(attempt, error) {
  return {
    ...attempt,
    status: 'failed',
    failure: {
      reason: 'attempt_failed',
      message: error?.message || String(error),
      retryable: true,
    },
  };
}

export async function runSwarmAttemptsBounded({
  attempts = [],
  concurrency = 2,
  runAttempt,
  onAttemptEvent,
} = {}) {
  if (typeof runAttempt !== 'function') {
    throw new Error('runAttempt must be a function');
  }
  const limit = clampConcurrency(concurrency, attempts.length);
  const results = new Array(attempts.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < attempts.length) {
      const index = nextIndex;
      nextIndex += 1;
      const attempt = attempts[index];
      if (onAttemptEvent) {
        await onAttemptEvent({ type: 'started', attemptId: attempt.attemptId, attempt, index });
      }
      try {
        results[index] = await runAttempt({ attempt, index });
      } catch (error) {
        results[index] = failureRecord(attempt, error);
      }
      if (onAttemptEvent) {
        await onAttemptEvent({
          type: 'completed',
          attemptId: results[index]?.attemptId || attempt.attemptId,
          attempt: results[index],
          index,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
