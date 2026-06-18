export const HIGH_SIGNAL_EVENT_TYPES = new Set([
  'bes.recombination_proposed',
  'capabilities.runtime_mounted',
  'graph.context_composed',
  'memory.reflection_evaluated',
  'memory.corpus_scored',
  'experiment.decision_written',
  'swarm.orchestration_completed',
  'verifier.finished',
  'replay.cycle_completed',
  'recursive_evolution.coordinated',
  'partial_autonomy.applied',
]);

function taskPrefix(event) {
  return event.taskId ? `${event.taskId} ` : '';
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeReplayFeedback(replayFeedback) {
  if (!replayFeedback) return { items: [], regressionCount: 0 };
  if (Array.isArray(replayFeedback)) {
    return {
      items: replayFeedback,
      regressionCount: replayFeedback.reduce(
        (max, item) => Math.max(max, Number(item?.regressionCount) || 0),
        0,
      ),
    };
  }
  const items = asArray(replayFeedback.items);
  const regressionCount = Number.isFinite(Number(replayFeedback.regressionCount))
    ? Number(replayFeedback.regressionCount)
    : items.reduce((max, item) => Math.max(max, Number(item?.regressionCount) || 0), 0);
  return { items, regressionCount };
}

export function summarizeHarnessEvent(event = {}) {
  switch (event.type) {
    case 'bes.recombination_proposed':
      return `${taskPrefix(event)}recombined BES genome ${event.genome?.id || 'unknown'} is available`;
    case 'capabilities.runtime_mounted': {
      const counts = event.enabledCounts || {};
      const countText = ['skill', 'mcp', 'pi_extension', 'profile']
        .map((type) => `${counts[type] || 0} ${type}`)
        .join(', ');
      return `${taskPrefix(event)}scoped capabilities mounted from ${event.manifestPath || 'unknown manifest'} (${countText})`;
    }
    case 'graph.context_composed':
      return `${taskPrefix(event)}GraphRAG composed ${event.itemCount || 0} provenance-backed context item(s)`;
    case 'memory.reflection_evaluated':
      return `${taskPrefix(event)}memory ${event.memoryId || 'unknown'} is ${event.gate?.status || 'unknown'}`;
    case 'memory.corpus_scored':
      return `${taskPrefix(event)}memory corpus score ${event.averageScore ?? 0} with ${event.promotableCount || 0} promotable item(s)`;
    case 'experiment.decision_written':
      return `${taskPrefix(event)}experiment decision is ${event.decision?.conclusion || 'pending'}`;
    case 'swarm.orchestration_completed':
      return `${taskPrefix(event)}swarm champion ${event.archivedChampion?.attemptId || 'unknown'} is ready for approval`;
    case 'verifier.finished':
      return `${taskPrefix(event)}verifier finished with exit ${event.result?.exitCode ?? event.exitCode ?? 'unknown'}`;
    case 'replay.cycle_completed': {
      const ranCount = asArray(event.ran).length;
      const skippedCount = asArray(event.skipped).length;
      return `${taskPrefix(event)}replay cycle completed (ran ${ranCount}, skipped ${skippedCount})`;
    }
    case 'recursive_evolution.coordinated':
      return `${taskPrefix(event)}recursive evolution coordinated`;
    case 'partial_autonomy.applied':
      return `${taskPrefix(event)}partial autonomy applied${event.replayReportId ? ` from replay ${event.replayReportId}` : ''}`;
    default:
      return '';
  }
}

export function createHarnessFeedbackBuffer({ maxItems = 8 } = {}) {
  let items = [];

  return {
    record(event) {
      if (!HIGH_SIGNAL_EVENT_TYPES.has(event?.type)) return null;
      const summary = summarizeHarnessEvent(event);
      if (!summary) return null;

      const item = {
        type: event.type,
        taskId: event.taskId,
        summary,
        recordedAt: new Date().toISOString(),
      };
      items.push(item);
      items = items.slice(-maxItems);
      return item;
    },

    items() {
      return [...items];
    },

    drain() {
      const drained = [...items];
      items = [];
      return drained;
    },
  };
}

export function applyHarnessFeedbackToPrompt({
  message,
  feedback,
  replayFeedback,
  enabled = true,
} = {}) {
  if (!enabled) return message;
  if (!feedback && !replayFeedback) return message;

  const bufferItems = typeof feedback?.drain === 'function' ? feedback.drain() : [];
  const { items: replayItems, regressionCount } = normalizeReplayFeedback(replayFeedback);
  const items = [...bufferItems, ...replayItems];
  if (!items.length) return message;

  const contextLines = items.map((item) => `- ${item.summary}`);
  if (regressionCount > 0 && !contextLines.some((line) => /regression warning/i.test(line))) {
    contextLines.push(`- regression warning: ${regressionCount} replay regression(s) require review`);
  }

  return [
    '[Helios Harness Context]',
    contextLines.join('\n'),
    '[/Helios Harness Context]',
    '',
    'User request:',
    message,
  ].join('\n');
}
