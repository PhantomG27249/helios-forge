import { isAbsolute, join, relative, resolve } from 'node:path';

import {
  appendA2aLineageHop,
  compactA2aLineageForDashboard,
} from './a2aMultiHopLineage.js';
import { createJsonFileA2ADurableStore } from './a2aDurableStore.js';
import { createProductionQueueProvider } from './productionQueueProvider.js';

function safeObject(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resolveNow(now) {
  if (typeof now === 'function') return now();
  if (now instanceof Date) return now;
  return new Date();
}

function gateFromHarnessConfig(harnessConfig = {}, gateName) {
  const caps = safeObject(harnessConfig.productionCapabilities);
  return safeObject(caps[gateName] || harnessConfig[gateName]);
}

export function a2aPeerCycleGatesEnabled(harnessConfig = {}) {
  const transport = gateFromHarnessConfig(harnessConfig, 'productionA2aTransport');
  const queues = gateFromHarnessConfig(harnessConfig, 'productionA2aQueues');
  return transport.enabled === true && queues.enabled === true;
}

function assertInsideRoot(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolvedTarget;
  }
  throw new Error('A2A peer cycle artifact path escapes allowed root');
}

function resolveQueueProvider({
  workspaceRoot,
  harnessConfig,
  productionQueueProvider,
  role,
}) {
  if (typeof productionQueueProvider === 'function') {
    return productionQueueProvider({ workspaceRoot, role, harnessConfig });
  }
  if (productionQueueProvider?.[role]) {
    return productionQueueProvider[role];
  }
  return createProductionQueueProvider({
    workspaceRoot,
    featureFlags: harnessConfig,
  });
}

function buildPeerCycleLineage(cycleId) {
  const hops = [
    { messageId: `${cycleId}-agent`, from: 'agent', to: 'swarm', layer: 'agent' },
    { messageId: `${cycleId}-swarm`, from: 'swarm', to: 'local-harness', layer: 'swarm' },
    { messageId: `${cycleId}-harness`, from: 'local-harness', to: 'peer-harness', layer: 'harness' },
    { messageId: `${cycleId}-peer`, from: 'peer-harness', to: 'local-harness', layer: 'peer' },
  ];
  let lineage = [];
  for (const hop of hops) {
    lineage = appendA2aLineageHop({ lineage, hop });
  }
  return lineage;
}

function evidenceRecord(base = {}) {
  return {
    ...base,
    authority: 'evidence_only',
    canPromote: false,
    evidenceOnly: true,
    trust: {
      authority: 'evidence_only',
      canPromote: false,
      evidenceOnly: true,
      verified: false,
      external: true,
    },
  };
}

function persistPeerCycleSummary(workspaceRoot, summary) {
  const artifactPath = assertInsideRoot(
    workspaceRoot,
    join(workspaceRoot, '.harness', 'a2a', 'peer-cycles', `${summary.cycleId}.json`),
  );
  const store = createJsonFileA2ADurableStore({ path: artifactPath, root: workspaceRoot });
  store.save(summary);
  return artifactPath;
}

export async function runA2aPeerCycle({
  localWorkspaceRoot,
  peerWorkspaceRoot,
  harnessConfig = {},
  productionQueueProvider,
  now,
} = {}) {
  if (!a2aPeerCycleGatesEnabled(harnessConfig)) {
    return { skipped: true, reason: 'a2a_gates_disabled' };
  }

  const timestamp = resolveNow(now);
  const cycleId = `peer-cycle-${timestamp.toISOString().replace(/[:.]/g, '-')}`;
  const taskId = `task-${cycleId}`;
  const lineage = buildPeerCycleLineage(cycleId);
  const lineageCompact = compactA2aLineageForDashboard(lineage);

  const localProvider = resolveQueueProvider({
    workspaceRoot: localWorkspaceRoot,
    harnessConfig,
    productionQueueProvider,
    role: 'local',
  });
  const peerProvider = resolveQueueProvider({
    workspaceRoot: peerWorkspaceRoot,
    harnessConfig,
    productionQueueProvider,
    role: 'peer',
  });

  const requestMessageId = `${cycleId}-request`;
  const responseMessageId = `${cycleId}-response`;

  const localOutboxEnqueue = localProvider.enqueue('outbox', evidenceRecord({
    messageId: requestMessageId,
    taskId,
    cycleId,
    direction: 'request',
    lineage,
    lineageCompact,
    payload: { kind: 'peer_cycle_request', cycleId },
  }));

  const peerInboxHydrate = peerProvider.enqueue('inbox', evidenceRecord({
    ...localOutboxEnqueue,
    status: 'hydrated',
    hydratedAt: timestamp.toISOString(),
  }));
  peerProvider.hydrate();

  const peerResponseEnqueue = peerProvider.enqueue('outbox', evidenceRecord({
    messageId: responseMessageId,
    parentMessageId: requestMessageId,
    taskId,
    cycleId,
    direction: 'response',
    lineage,
    lineageCompact,
    inReplyTo: requestMessageId,
    payload: { kind: 'peer_cycle_response', cycleId, ack: true },
  }));

  const localInboxReceive = localProvider.enqueue('inbox', evidenceRecord({
    ...peerResponseEnqueue,
    status: 'received',
    receivedAt: timestamp.toISOString(),
  }));

  const localInboxAck = localProvider.ack({
    queue: 'inbox',
    messageId: responseMessageId,
    status: 'acknowledged',
    patch: {
      cycleId,
      taskId,
      acknowledgedAt: timestamp.toISOString(),
    },
  });

  const summary = evidenceRecord({
    cycleId,
    taskId,
    completedAt: timestamp.toISOString(),
    role: null,
    phases: {
      localOutboxEnqueue,
      peerInboxHydrate,
      peerResponseEnqueue,
      localInboxAck,
    },
    lineage,
    lineageCompact,
    queues: {
      localOutbox: localProvider.list('outbox').length,
      localInbox: localProvider.list('inbox').length,
      peerOutbox: peerProvider.list('outbox').length,
      peerInbox: peerProvider.list('inbox').length,
    },
  });

  const localArtifactPath = persistPeerCycleSummary(localWorkspaceRoot, {
    ...summary,
    role: 'local',
    workspaceRoot: localWorkspaceRoot,
    peerWorkspaceRoot,
  });
  const peerArtifactPath = persistPeerCycleSummary(peerWorkspaceRoot, {
    ...summary,
    role: 'peer',
    workspaceRoot: peerWorkspaceRoot,
    peerWorkspaceRoot: localWorkspaceRoot,
  });

  return {
    cycleId,
    taskId,
    authority: 'evidence_only',
    canPromote: false,
    evidenceOnly: true,
    lineage,
    lineageCompact,
    phases: summary.phases,
    artifacts: {
      local: localArtifactPath,
      peer: peerArtifactPath,
    },
    localInboxReceive,
    localInboxAck,
  };
}
