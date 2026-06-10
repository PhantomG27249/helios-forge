import { getTrustRank, normalizeAgentCard, normalizeAgentCards } from './agentCards.js';
import { buildGatewayRequest } from './agentRouter.js';
import { verifyDelegatedCapabilityToken } from './delegatedCapabilityTokens.js';

function normalizeList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return list.map((value) => String(value || '').trim()).filter(Boolean);
}

function isMutationTask(task = {}) {
  if (task.mutation === true || task.mode === 'mutation') return true;
  return normalizeList(task.requiredCapabilities).some((capability) => (
    /\.(apply|write|update|delete|create|merge|exec)$/i.test(capability)
    || /^(patch|write|delete|create|merge|shell|exec)\b/i.test(capability)
  ));
}

function emit(emitEvent, event) {
  if (typeof emitEvent === 'function') emitEvent(event);
}

function cloneSerializable(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeRetryPolicy(policy = {}) {
  const maxAttempts = Number(policy.maxAttempts ?? 1);
  const backoffMs = Number(policy.backoffMs ?? 0);
  return {
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.floor(maxAttempts) : 1,
    backoffMs: Number.isFinite(backoffMs) && backoffMs > 0 ? Math.floor(backoffMs) : 0,
  };
}

function recordView(record) {
  return cloneSerializable(record);
}

function endpointDescriptor(agent = {}) {
  const endpoint = agent.endpoint && typeof agent.endpoint === 'object'
    ? Object.fromEntries(
      Object.entries(agent.endpoint)
        .filter(([key]) => !/socket|server|listener|connection/i.test(key)),
    )
    : agent.endpoint;
  return cloneSerializable({
    id: agent.id,
    name: agent.name,
    protocol: agent.protocol,
    endpoint,
    command: agent.command,
    capabilities: agent.capabilities,
    costModel: agent.costModel,
    latencyStats: agent.latencyStats,
    trustLevel: agent.trustLevel,
    toolPermissions: agent.toolPermissions,
    available: agent.available,
    metadata: agent.metadata,
  });
}

function recordsFromState(records) {
  if (Array.isArray(records)) return records;
  if (records && typeof records === 'object') return Object.values(records);
  return [];
}

function loadIssuerSecret(store) {
  if (!store) return undefined;
  if (typeof store === 'function') return store();
  if (typeof store.loadIssuerSecret === 'function') return store.loadIssuerSecret();
  if (typeof store.load === 'function') return store.load();
  if (typeof store.get === 'function') return store.get('issuerSecret');
  if (typeof store.issuerSecret === 'string') return store.issuerSecret;
  return undefined;
}

function markExternalA2aContextUntrusted(envelope = {}) {
  const a2a = envelope.task?.context?.a2a;
  if (!a2a || typeof a2a !== 'object' || Array.isArray(a2a)) return envelope;
  return {
    ...envelope,
    task: {
      ...envelope.task,
      context: {
        ...envelope.task.context,
        a2a: {
          ...a2a,
          trust: {
            ...(a2a.trust || {}),
            external: true,
            verified: false,
          },
        },
      },
    },
  };
}

function mutationTrustFailure({
  agent,
  task = {},
  capabilities = [],
  approval,
  capabilityToken,
  now,
  issuerSecret,
  requireStableIssuerSecret = false,
} = {}) {
  if (!isMutationTask(task)) return null;
  const normalizedCapabilities = normalizeList(capabilities);
  if (normalizedCapabilities.length === 0) {
    return {
      reason: 'mutation_capability_required',
      tokenReasons: [],
    };
  }
  if (approval?.approved !== true) {
    return {
      reason: 'mutation_requires_approval',
      tokenReasons: [],
    };
  }
  if (!capabilityToken) {
    return {
      reason: 'delegated_capability_token_required',
      tokenReasons: [],
    };
  }
  if (requireStableIssuerSecret && !issuerSecret) {
    return {
      reason: 'issuer_secret_required',
      tokenReasons: [],
    };
  }

  const timestamp = now();
  const tokenDecisions = normalizedCapabilities.map((capability) => ({
    label: capability,
    decision: verifyDelegatedCapabilityToken(capabilityToken, {
      taskId: task.id,
      agentId: agent.id,
      capability,
      mode: 'mutation',
      now: timestamp,
      issuerSecret,
    }),
  }));
  const scopeDecisions = normalizeList(task.requiredScopes).map((scope) => ({
    label: scope,
    decision: verifyDelegatedCapabilityToken(capabilityToken, {
      taskId: task.id,
      agentId: agent.id,
      capability: normalizedCapabilities[0],
      scope,
      mode: 'mutation',
      now: timestamp,
      issuerSecret,
    }),
  }));
  const tokenReasons = [...tokenDecisions, ...scopeDecisions].flatMap(({ label, decision }) => (
    decision.reasons.map((reason) => `${label}:${reason}`)
  ));
  if (tokenReasons.length) {
    return {
      reason: 'delegated_capability_token_invalid',
      tokenReasons,
    };
  }
  return null;
}

export class ExternalAgentGateway {
  constructor({
    agents = [],
    dispatch,
    emitEvent,
    now = Date.now,
    durableStore = null,
    durableState = null,
    issuerSecret,
    issuerSecretStore = null,
    requireStableIssuerSecret = false,
  } = {}) {
    if (dispatch && typeof dispatch !== 'function') {
      throw new Error('ExternalAgentGateway dispatch must be a function');
    }
    this.dispatch = dispatch || (async () => ({ ok: true }));
    this.emitEvent = emitEvent;
    this.now = now;
    this.durableStore = durableStore;
    this.issuerSecret = issuerSecret || loadIssuerSecret(issuerSecretStore);
    this.requireStableIssuerSecret = requireStableIssuerSecret;
    const restoredState = durableState || durableStore?.load?.() || {};
    const restoredPeers = recordsFromState(restoredState.peerEndpoints);
    const agentCards = agents.length ? agents : restoredPeers;
    this.agents = new Map(normalizeAgentCards(agentCards).map((agent) => [agent.id, agent]));
    this.outbox = new Map(recordsFromState(restoredState.outbox).map((record) => [record.messageId, cloneSerializable(record)]));
    this.inbox = new Map(recordsFromState(restoredState.inbox).map((record) => [record.messageId, cloneSerializable(record)]));
    this.sequence = 0;
  }

  snapshotDurableState() {
    return {
      outbox: [...this.outbox.values()].map((record) => recordView(record)),
      inbox: [...this.inbox.values()].map((record) => recordView(record)),
      peerEndpoints: [...this.agents.values()].map((agent) => endpointDescriptor(agent)),
    };
  }

  persistDurableState() {
    if (this.durableStore && typeof this.durableStore.save === 'function') {
      this.durableStore.save(this.snapshotDurableState());
    }
  }

  nextMessageId(prefix = 'a2a') {
    this.sequence += 1;
    return `${prefix}_${this.now().toString(36)}_${this.sequence.toString(36)}`;
  }

  listAgentCards() {
    return [...this.agents.values()].map((agent) => normalizeAgentCard(agent));
  }

  getAgent(agentId) {
    const agent = this.agents.get(String(agentId || ''));
    if (!agent) throw new Error(`Unknown external agent ${agentId || '(empty)'}`);
    return agent;
  }

  discoverPeers({
    protocol,
    capabilities = [],
    minTrustLevel = 'public',
  } = {}) {
    const requiredCapabilities = new Set(normalizeList(capabilities));
    const minTrustRank = getTrustRank(minTrustLevel);
    const normalizedProtocol = protocol ? String(protocol).trim().toLowerCase() : null;
    return this.listAgentCards()
      .filter((agent) => agent.available !== false)
      .filter((agent) => !normalizedProtocol || agent.protocol === normalizedProtocol)
      .filter((agent) => agent.trustRank >= minTrustRank)
      .filter((agent) => [...requiredCapabilities].every((capability) => agent.capabilities.includes(capability)))
      .sort((left, right) => (
        right.trustRank - left.trustRank
        || left.id.localeCompare(right.id)
      ));
  }

  buildEnvelope({ agentId, task = {}, grantedCapabilities } = {}) {
    const agent = this.getAgent(agentId);
    const envelope = markExternalA2aContextUntrusted(buildGatewayRequest({
      agent,
      task,
      grantedCapabilities,
    }));
    return {
      ...envelope,
      mode: isMutationTask(task) ? 'mutation' : 'read',
    };
  }

  enqueueTask({
    agentId,
    task = {},
    grantedCapabilities,
    approval,
    capabilityToken,
    retryPolicy,
  } = {}) {
    const agent = this.getAgent(agentId);
    const capabilities = normalizeList(grantedCapabilities || task.requiredCapabilities);
    const trustFailure = mutationTrustFailure({
      agent,
      task,
      capabilities,
      approval,
      capabilityToken,
      now: this.now,
      issuerSecret: this.issuerSecret,
      requireStableIssuerSecret: this.requireStableIssuerSecret,
    });
    if (trustFailure) {
      throw new Error(`${trustFailure.reason}${trustFailure.tokenReasons.length ? `: ${trustFailure.tokenReasons.join(', ')}` : ''}`);
    }

    const timestamp = this.now();
    const messageId = this.nextMessageId('outbox');
    const correlationId = String(task.correlationId || task.id || messageId);
    const normalizedRetryPolicy = normalizeRetryPolicy(retryPolicy);
    const envelope = this.buildEnvelope({ agentId, task, grantedCapabilities });
    envelope.durable = {
      direction: 'outbox',
      messageId,
      correlationId,
      createdAt: timestamp,
      updatedAt: timestamp,
      retryPolicy: normalizedRetryPolicy,
    };

    const record = {
      direction: 'outbox',
      status: 'queued',
      messageId,
      correlationId,
      agentId: envelope.agent.id,
      taskId: String(task.id || ''),
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      nextAttemptAt: timestamp,
      retryPolicy: normalizedRetryPolicy,
      envelope,
      response: null,
      error: null,
    };
    this.outbox.set(messageId, record);
    this.persistDurableState();
    emit(this.emitEvent, {
      type: 'external_agent.outbox_queued',
      agentId: record.agentId,
      taskId: record.taskId,
      messageId,
      correlationId,
    });
    return recordView(record);
  }

  async drainOutbox({ limit = Infinity } = {}) {
    const drained = [];
    const maxItems = Number.isFinite(Number(limit)) ? Number(limit) : Infinity;
    for (const record of this.outbox.values()) {
      if (drained.length >= maxItems) break;
      if (!['queued', 'retry_scheduled'].includes(record.status)) continue;
      if (record.nextAttemptAt > this.now()) continue;

      record.attempts += 1;
      record.updatedAt = this.now();
      record.envelope.durable.updatedAt = record.updatedAt;
      record.envelope.durable.attempt = record.attempts;

      try {
        const response = await this.dispatch(record.envelope);
        record.status = 'dispatched';
        record.response = cloneSerializable(response);
        record.error = null;
        record.updatedAt = this.now();
        record.envelope.durable.updatedAt = record.updatedAt;
        emit(this.emitEvent, {
          type: 'external_agent.dispatched',
          agentId: record.agentId,
          taskId: record.taskId,
          mode: record.envelope.mode,
          messageId: record.messageId,
          correlationId: record.correlationId,
        });
      } catch (error) {
        record.error = String(error?.message || error);
        record.updatedAt = this.now();
        record.envelope.durable.updatedAt = record.updatedAt;
        if (record.attempts < record.retryPolicy.maxAttempts) {
          record.status = 'retry_scheduled';
          record.nextAttemptAt = this.now() + (record.retryPolicy.backoffMs * record.attempts);
          emit(this.emitEvent, {
            type: 'external_agent.retry_scheduled',
            agentId: record.agentId,
            taskId: record.taskId,
            messageId: record.messageId,
            correlationId: record.correlationId,
            attempts: record.attempts,
            nextAttemptAt: record.nextAttemptAt,
          });
        } else {
          record.status = 'failed';
          emit(this.emitEvent, {
            type: 'external_agent.failed',
            agentId: record.agentId,
            taskId: record.taskId,
            messageId: record.messageId,
            correlationId: record.correlationId,
            attempts: record.attempts,
            error: record.error,
          });
        }
      }
      this.persistDurableState();
      drained.push(recordView(record));
    }
    return drained;
  }

  receiveEnvelope(envelope = {}) {
    const timestamp = this.now();
    const durable = envelope.durable || {};
    const messageId = String(durable.messageId || envelope.message?.messageId || this.nextMessageId('inbox'));
    const existing = this.inbox.get(messageId);
    if (existing) {
      return {
        status: 'duplicate',
        record: recordView(existing),
      };
    }

    const record = {
      direction: 'inbox',
      status: 'received',
      messageId,
      correlationId: String(durable.correlationId || envelope.message?.correlationId || messageId),
      from: String(envelope.from || ''),
      to: String(envelope.to || ''),
      receivedAt: timestamp,
      updatedAt: timestamp,
      envelope: cloneSerializable(envelope),
      progress: null,
      cancellation: null,
    };
    this.inbox.set(messageId, record);
    this.persistDurableState();
    emit(this.emitEvent, {
      type: 'external_agent.inbox_received',
      messageId: record.messageId,
      correlationId: record.correlationId,
      from: record.from,
    });
    return {
      status: 'received',
      record: recordView(record),
    };
  }

  listInbox() {
    return [...this.inbox.values()].map((record) => recordView(record));
  }

  getInboxRecord(messageId) {
    const record = this.inbox.get(String(messageId || ''));
    return record ? recordView(record) : null;
  }

  getOutboxRecord(messageId) {
    const record = this.outbox.get(String(messageId || ''));
    return record ? recordView(record) : null;
  }

  findDurableRecord(messageId) {
    const id = String(messageId || '');
    return this.inbox.get(id) || this.outbox.get(id) || null;
  }

  buildControlEnvelope({ record, kind, body = {} }) {
    const messageId = this.nextMessageId(kind);
    return {
      protocol: 'a2a',
      version: '0.1',
      from: 'helios.sidecar',
      to: record.from || record.agentId || '',
      durable: {
        direction: 'outbox',
        messageId,
        parentMessageId: record.messageId,
        correlationId: record.correlationId,
        createdAt: this.now(),
      },
      message: {
        kind,
        messageId,
        parentMessageId: record.messageId,
        correlationId: record.correlationId,
        ...body,
      },
    };
  }

  recordProgress({
    messageId,
    percent,
    detail,
    payload = {},
  } = {}) {
    const record = this.findDurableRecord(messageId);
    if (!record) throw new Error(`Unknown durable A2A message ${messageId || '(empty)'}`);
    const progress = {
      percent: Number(percent || 0),
      detail: String(detail || ''),
      payload: cloneSerializable(payload),
      updatedAt: this.now(),
    };
    record.status = record.status === 'received' ? 'in_progress' : record.status;
    record.progress = progress;
    record.updatedAt = progress.updatedAt;
    this.persistDurableState();
    const envelope = this.buildControlEnvelope({
      record,
      kind: 'progress',
      body: progress,
    });
    emit(this.emitEvent, {
      type: 'external_agent.progress',
      messageId: record.messageId,
      correlationId: record.correlationId,
      percent: progress.percent,
    });
    return {
      status: 'progress',
      record: recordView(record),
      envelope: cloneSerializable(envelope),
    };
  }

  cancelMessage({
    messageId,
    reason = 'cancelled',
  } = {}) {
    const record = this.findDurableRecord(messageId);
    if (!record) throw new Error(`Unknown durable A2A message ${messageId || '(empty)'}`);
    const cancellation = {
      reason: String(reason || 'cancelled'),
      cancelledAt: this.now(),
    };
    record.status = 'cancelled';
    record.cancellation = cancellation;
    record.updatedAt = cancellation.cancelledAt;
    this.persistDurableState();
    const envelope = this.buildControlEnvelope({
      record,
      kind: 'cancel',
      body: cancellation,
    });
    emit(this.emitEvent, {
      type: 'external_agent.cancelled',
      messageId: record.messageId,
      correlationId: record.correlationId,
      reason: cancellation.reason,
    });
    return {
      status: 'cancelled',
      record: recordView(record),
      envelope: cloneSerializable(envelope),
    };
  }

  async dispatchTask({
    agentId,
    task = {},
    grantedCapabilities,
    approval,
    capabilityToken,
  } = {}) {
    const agent = this.getAgent(agentId);
    const mutation = isMutationTask(task);
    const capabilities = normalizeList(grantedCapabilities || task.requiredCapabilities);

    if (mutation && approval?.approved !== true) {
      emit(this.emitEvent, {
        type: 'external_agent.blocked',
        agentId: agent.id,
        taskId: task.id,
        reason: 'mutation_requires_approval',
      });
      return {
        status: 'blocked',
        reason: 'mutation_requires_approval',
      };
    }

    if (mutation) {
      const trustFailure = mutationTrustFailure({
        agent,
        task,
        capabilities,
        approval,
        capabilityToken,
        now: this.now,
        issuerSecret: this.issuerSecret,
        requireStableIssuerSecret: this.requireStableIssuerSecret,
      });
      if (trustFailure) {
        emit(this.emitEvent, {
          type: 'external_agent.blocked',
          agentId: agent.id,
          taskId: task.id,
          reason: trustFailure.reason,
          tokenReasons: trustFailure.tokenReasons,
        });
        return {
          status: 'blocked',
          reason: trustFailure.reason,
          tokenReasons: trustFailure.tokenReasons,
        };
      }
    }

    const envelope = this.buildEnvelope({ agentId: agent.id, task, grantedCapabilities });
    const response = await this.dispatch(envelope);
    emit(this.emitEvent, {
      type: 'external_agent.dispatched',
      agentId: agent.id,
      taskId: task.id,
      mode: envelope.mode,
    });
    return {
      status: 'dispatched',
      envelope,
      response,
    };
  }
}
