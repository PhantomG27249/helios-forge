import { redactSecrets } from './agentCards.js';

function normalizedList(value = []) {
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => String(item || '').trim()).filter(Boolean);
}

function safeObject(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function scopedContext(context = {}) {
  const allowedKeys = [
    'allowedFiles',
    'assignedFiles',
    'contextPackId',
    'sourceLabels',
    'artifacts',
    'visualArtifacts',
    'memoryRefs',
    'graphRefs',
    'besLane',
    'rhoCaseIds',
    'memoryGraphRefs',
    'candidateRef',
    'lineage',
    'trust',
    'requiredVerification',
  ];
  const scoped = {};
  for (const key of allowedKeys) {
    if (context[key] !== undefined) scoped[key] = context[key];
  }
  scoped.allowedFiles = normalizedList(scoped.allowedFiles || scoped.assignedFiles);
  if (scoped.assignedFiles) scoped.assignedFiles = normalizedList(scoped.assignedFiles);
  return redactSecrets(scoped);
}

function normalizedLineageObjects(value = []) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => redactSecrets({
      messageId: item.messageId,
      parentMessageId: item.parentMessageId,
      rootMessageId: item.rootMessageId,
      from: item.from,
      to: item.to,
      taskId: item.taskId,
      attemptId: item.attemptId,
    }));
}

function durableEnvelopeContext({ durable = {}, lineage = [] } = {}) {
  const safeDurable = safeObject(durable);
  const hops = normalizedLineageObjects(lineage);
  if (Object.keys(safeDurable).length === 0 && hops.length === 0) return {};
  const context = {
    direction: safeDurable.direction || 'outbox',
    messageId: safeDurable.messageId,
    parentMessageId: safeDurable.parentMessageId,
    rootMessageId: safeDurable.rootMessageId,
    correlationId: safeDurable.correlationId,
    lineage: hops,
  };
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => (
      value !== undefined && (!Array.isArray(value) || value.length > 0)
    )),
  );
}

export function buildSwarmA2AEnvelope({
  task = {},
  attempt = {},
  role = 'implementer',
  context = {},
  budget = {},
  outputContract = {},
  from = 'helios.sidecar',
  to,
  durable,
  lineage = [],
} = {}) {
  const safeTask = safeObject(task);
  const safeAttempt = safeObject(attempt);
  const safeContext = safeObject(context);
  const safeBudget = safeObject(budget);
  const safeOutputContract = safeObject(outputContract);
  const taskId = safeTask.taskId || safeTask.id || 'task_swarm';
  const attemptId = safeAttempt.attemptId || safeAttempt.id || 'attempt_1';
  const durableContext = durableEnvelopeContext({ durable, lineage });
  return redactSecrets({
    protocol: 'a2a',
    version: '0.1',
    from,
    to: to || `pi-native:${attemptId}`,
    ...(Object.keys(durableContext).length ? { durable: durableContext } : {}),
    message: {
      kind: 'swarm_attempt',
      taskId,
      attemptId,
      role,
      task: {
        taskId,
        task: safeTask.task || safeTask.goal || safeTask.summary || '',
        mode: safeTask.mode,
      },
      strategy: safeAttempt.strategy || null,
      planning: safeObject(safeAttempt.planning),
      context: scopedContext(safeContext),
      budget: safeBudget,
      outputContract: {
        ...safeOutputContract,
        requiredFields: normalizedList(safeOutputContract.requiredFields),
      },
      replyContract: {
        format: 'compact_handoff_json',
        requiredFields: ['summary', 'verifierEvidence'],
        visibleThinkingOnly: true,
      },
    },
  });
}

function normalizeEvent(event = 'chunk') {
  const normalized = String(event || 'chunk').trim().toLowerCase();
  if (normalized === 'cancelled') return 'cancel';
  if (normalized === 'progress') return 'progress';
  if (normalized === 'done' || normalized === 'complete') return 'complete';
  if (normalized === 'error') return 'error';
  if (normalized === 'cancel') return 'cancel';
  return 'chunk';
}

function makeStreamMessageId({ streamId, sequence }) {
  return `stream_${String(streamId || 'default')}_${Number(sequence || 0)}`;
}

export function buildA2AStreamEnvelope({
  streamId,
  sequence = 0,
  correlationId,
  from = 'helios.sidecar',
  to,
  event = 'chunk',
  payload = {},
  progress,
  cancellation,
  done = false,
} = {}) {
  const normalizedEvent = normalizeEvent(event);
  const id = makeStreamMessageId({ streamId, sequence });
  return redactSecrets({
    protocol: 'a2a',
    version: '0.1',
    from,
    to: to || 'helios.sidecar',
    durable: {
      direction: 'stream',
      messageId: id,
      correlationId: String(correlationId || streamId || id),
      streamId: String(streamId || 'stream'),
      sequence: Number(sequence || 0),
    },
    message: {
      kind: `stream_${normalizedEvent}`,
      stream: {
        streamId: String(streamId || 'stream'),
        sequence: Number(sequence || 0),
        done: Boolean(done || normalizedEvent === 'complete'),
      },
      payload: safeObject(payload),
      progress: progress === undefined ? undefined : safeObject(progress),
      cancellation: cancellation === undefined ? undefined : safeObject(cancellation),
    },
  });
}
