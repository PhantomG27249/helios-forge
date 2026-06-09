import {
  createAdaptiveSearchScheduler,
  recordAdaptiveSearchOutcome,
  selectAdaptiveSearchAction,
} from './adaptiveSearchScheduler.js';

const REDACTED = '[redacted]';
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|credential|password|secret|token)/i;
const PRIVATE_URL_KEY_PATTERN = /(baseurl|endpoint|url|uri)/i;
const MAX_RECENT_EVENTS = 25;

export function redactAdaptiveSearchPayload(value) {
  return redactValue(value);
}

export function summarizeAdaptiveSearchEvents({ events = [], taskId = null, limit = MAX_RECENT_EVENTS } = {}) {
  const adaptiveEvents = events.filter((event) => typeof event?.type === 'string' && event.type.startsWith('ab_mcts.'));
  const selections = adaptiveEvents.filter((event) => event.type === 'ab_mcts.action_selected');
  const outcomes = adaptiveEvents.filter((event) => event.type === 'ab_mcts.outcome_recorded');
  const summaries = adaptiveEvents.filter((event) => event.type === 'ab_mcts.scheduler_summary');
  const selectedArmCounts = selections.reduce((counts, event) => {
    const arm = event.selectedArm || event.arm || 'unknown';
    counts[arm] = (counts[arm] || 0) + 1;
    return counts;
  }, {});

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : MAX_RECENT_EVENTS;

  return redactValue({
    taskId,
    eventCount: adaptiveEvents.length,
    selectionCount: selections.length,
    outcomeCount: outcomes.length,
    summaryCount: summaries.length,
    selectedArmCounts,
    latestSelection: selections.at(-1) || null,
    latestOutcome: outcomes.at(-1) || null,
    latestSummary: summaries.at(-1) || null,
    firstTimestamp: adaptiveEvents.find((event) => event.timestamp)?.timestamp || null,
    lastTimestamp: [...adaptiveEvents].reverse().find((event) => event.timestamp)?.timestamp || null,
    recentEvents: adaptiveEvents.slice(-safeLimit),
  });
}

export function replayAdaptiveSearchSelection({
  events = [],
  context = {},
  evidence,
  schedulerState,
  policy,
  rng,
  taskId,
} = {}) {
  const scheduler = schedulerState && typeof schedulerState === 'object'
    ? hydrateScheduler(schedulerState, rng)
    : createAdaptiveSearchScheduler({ policy, rng });
  const safeTaskId = taskId || context.taskId || context.contextId || inferTaskId(events);
  const derivedEvidence = Array.isArray(evidence) ? evidence : deriveEvidence(events);

  applyOutcomesToScheduler({ scheduler, events });

  const selection = selectAdaptiveSearchAction({
    scheduler,
    context: {
      ...context,
      taskId: safeTaskId,
      evidence: derivedEvidence,
      evidenceCount: Number.isFinite(context.evidenceCount) ? context.evidenceCount : derivedEvidence.length,
    },
  });

  return redactValue({
    taskId: safeTaskId,
    dryRun: true,
    mutatedTaskState: false,
    evidenceCount: derivedEvidence.length,
    selection,
    scheduler: summarizeScheduler(scheduler),
  });
}

function hydrateScheduler(schedulerState, rng) {
  const scheduler = {
    ...schedulerState,
    policy: { ...(schedulerState.policy || {}) },
    arms: { ...(schedulerState.arms || {}) },
    actions: { ...(schedulerState.actions || {}) },
    history: Array.isArray(schedulerState.history) ? [...schedulerState.history] : [],
    nextActionNumber: Number.isFinite(schedulerState.nextActionNumber) ? schedulerState.nextActionNumber : 1,
  };
  Object.defineProperty(scheduler, 'rng', {
    value: typeof rng === 'function' ? rng : () => 0,
    enumerable: false,
    writable: true,
  });
  return scheduler;
}

function deriveEvidence(events) {
  return events
    .filter((event) => event && typeof event === 'object' && !String(event.type || '').startsWith('ab_mcts.'))
    .map((event) => {
      const evidence = {
        type: event.type || 'trace.event',
        timestamp: event.timestamp || null,
      };
      for (const key of ['passed', 'confidence', 'score', 'status', 'kind', 'reason']) {
        if (event[key] !== undefined) evidence[key] = event[key];
      }
      return evidence;
    });
}

function inferTaskId(events) {
  return events.find((event) => event?.taskId)?.taskId || 'adaptive_search_replay';
}

function applyOutcomesToScheduler({ scheduler, events }) {
  for (const event of events) {
    if (event?.type === 'ab_mcts.action_selected' && event.actionId) {
      const arm = event.selectedArm || event.arm;
      if (!arm || !scheduler.arms?.[arm]) continue;
      scheduler.actions[event.actionId] = {
        actionId: event.actionId,
        arm,
        context: event.context || {},
        selectedAt: scheduler.history.length + 1,
      };
      scheduler.history.push({
        type: 'selected',
        actionId: event.actionId,
        arm,
        context: event.context || {},
      });
    }
    if (event?.type === 'ab_mcts.outcome_recorded' && event.actionId) {
      try {
        recordAdaptiveSearchOutcome({
          scheduler,
          actionId: event.actionId,
          reward: event.reward,
          evidence: event.evidence,
        });
      } catch {
        // Ignore orphaned trace outcomes during advisory replay.
      }
    }
  }
}

function summarizeScheduler(scheduler) {
  return {
    version: scheduler.version,
    policy: scheduler.policy,
    arms: Object.values(scheduler.arms || {}).map((arm) => ({
      arm: arm.arm,
      visits: arm.visits,
      totalReward: arm.totalReward,
      evidenceCount: arm.evidenceCount,
      lastReward: arm.lastReward,
    })),
    historyCount: scheduler.history?.length || 0,
  };
}

function redactValue(value, keyPath = []) {
  const key = keyPath.at(-1) || '';
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(key)) return REDACTED;
    if (PRIVATE_URL_KEY_PATTERN.test(key) && /private|internal|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value)) {
      return REDACTED;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(entry, [...keyPath, String(index)]));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      SECRET_KEY_PATTERN.test(childKey)
        ? REDACTED
        : redactValue(childValue, [...keyPath, childKey]),
    ]),
  );
}
