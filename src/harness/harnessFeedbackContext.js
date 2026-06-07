const HIGH_SIGNAL_EVENT_TYPES = new Set([
  'bes.recombination_proposed',
  'capabilities.runtime_mounted',
  'graph.context_composed',
  'memory.reflection_evaluated',
  'memory.corpus_scored',
  'experiment.decision_written',
  'swarm.orchestration_completed',
  'verifier.finished',
]);

function taskPrefix(event) {
  return event.taskId ? `${event.taskId} ` : '';
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

export function applyHarnessFeedbackToPrompt({ message, feedback, enabled = true } = {}) {
  if (!enabled || !feedback) return message;
  const items = feedback.drain();
  if (!items.length) return message;

  const context = items.map((item) => `- ${item.summary}`).join('\n');
  return [
    '[Helios Harness Context]',
    context,
    '[/Helios Harness Context]',
    '',
    'User request:',
    message,
  ].join('\n');
}
