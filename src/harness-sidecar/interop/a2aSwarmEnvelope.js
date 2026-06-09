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
  ];
  const scoped = {};
  for (const key of allowedKeys) {
    if (context[key] !== undefined) scoped[key] = context[key];
  }
  scoped.allowedFiles = normalizedList(scoped.allowedFiles || scoped.assignedFiles);
  if (scoped.assignedFiles) scoped.assignedFiles = normalizedList(scoped.assignedFiles);
  return redactSecrets(scoped);
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
} = {}) {
  const safeTask = safeObject(task);
  const safeAttempt = safeObject(attempt);
  const safeContext = safeObject(context);
  const safeBudget = safeObject(budget);
  const safeOutputContract = safeObject(outputContract);
  const taskId = safeTask.taskId || safeTask.id || 'task_swarm';
  const attemptId = safeAttempt.attemptId || safeAttempt.id || 'attempt_1';
  return redactSecrets({
    protocol: 'a2a',
    version: '0.1',
    from,
    to: to || `pi-native:${attemptId}`,
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
