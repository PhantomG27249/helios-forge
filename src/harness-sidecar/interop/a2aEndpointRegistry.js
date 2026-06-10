import { getTrustRank, normalizeAgentCard, redactSecrets } from './agentCards.js';

function cloneSerializable(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const normalized = [];
  for (const value of list) {
    const item = String(value || '').trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    normalized.push(item);
  }
  return normalized;
}

function recordsFromState(records) {
  if (Array.isArray(records)) return records;
  if (records && typeof records === 'object') return Object.values(records);
  return [];
}

function isMutationTask(task = {}) {
  if (task.mutation === true || task.mode === 'mutation') return true;
  return normalizeList(task.requiredCapabilities).some((capability) => (
    /\.(apply|write|update|delete|create|merge|exec)$/i.test(capability)
    || /^(patch|write|delete|create|merge|shell|exec)\b/i.test(capability)
  ));
}

function sanitizeEndpoint(endpoint = {}) {
  if (!endpoint || typeof endpoint !== 'object') return null;
  return redactSecrets(Object.fromEntries(
    Object.entries(endpoint)
      .filter(([key]) => !/socket|server|listener|connection|handle/i.test(key)),
  ));
}

function normalizeEndpointRecord(record = {}) {
  const card = normalizeAgentCard({
    ...record,
    protocol: record.protocol || 'a2a',
    endpoint: sanitizeEndpoint(record.endpoint || record.serverEndpoint || {}),
  });
  if (card.protocol !== 'a2a') {
    throw new Error(`A2A endpoint registry only accepts a2a peers: ${card.id}`);
  }
  return {
    ...card,
    endpointId: String(record.endpointId || `${card.id}:a2a`).trim(),
    queueId: String(record.queueId || `${card.id}:queue`).trim(),
    issuerKeyRef: record.issuerKeyRef ? String(record.issuerKeyRef).trim() : null,
    supportsStreaming: record.supportsStreaming !== false,
    restartPersistent: record.restartPersistent !== false,
    lineageRoot: record.lineageRoot ? String(record.lineageRoot).trim() : card.id,
    metadata: redactSecrets({
      ...(card.metadata || {}),
      ...(record.metadata || {}),
    }),
  };
}

function endpointView(record) {
  return cloneSerializable({
    endpointId: record.endpointId,
    id: record.id,
    name: record.name,
    protocol: record.protocol,
    endpoint: record.endpoint,
    capabilities: record.capabilities,
    trustLevel: record.trustLevel,
    trustRank: record.trustRank,
    queueId: record.queueId,
    issuerKeyRef: record.issuerKeyRef,
    supportsStreaming: record.supportsStreaming,
    restartPersistent: record.restartPersistent,
    available: record.available,
    metadata: record.metadata,
  });
}

function normalizeLineage(lineage = []) {
  return recordsFromState(lineage)
    .filter((hop) => hop && typeof hop === 'object' && !Array.isArray(hop))
    .map((hop) => redactSecrets({
      messageId: hop.messageId,
      parentMessageId: hop.parentMessageId,
      rootMessageId: hop.rootMessageId,
      from: hop.from,
      to: hop.to,
      taskId: hop.taskId,
      agentId: hop.agentId,
      endpointId: hop.endpointId,
    }));
}

function makeNegotiationId({ correlationId, sequence }) {
  return `neg_${String(correlationId || 'task').replace(/[^A-Za-z0-9_.:-]/g, '_')}_${sequence}`;
}

function scopedTask(task = {}, requestedCapabilities = []) {
  const capabilitySet = new Set(requestedCapabilities);
  const scopedContext = {};
  const context = task.context && typeof task.context === 'object' ? task.context : {};
  for (const capability of capabilitySet) {
    if (context[capability] !== undefined) scopedContext[capability] = context[capability];
  }
  return sanitizeExternalPayload(redactSecrets({
    id: task.id,
    correlationId: task.correlationId,
    prompt: sanitizeText(task.prompt),
    mode: task.mode,
    mutation: task.mutation === true,
    requiredCapabilities: requestedCapabilities,
    requiredScopes: normalizeList(task.requiredScopes),
    context: scopedContext,
  }));
}

function sanitizeText(value = '') {
  return String(value || '')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/gh[pousr]_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/\b(password|passwd|token|secret|credential|authorization|api[_-]?key|[A-Z0-9_]*API[_-]?KEY)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

function sanitizeExternalPayload(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeExternalPayload(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sanitizeExternalPayload(nestedValue),
      ]),
    );
  }
  return value;
}

export class A2AEndpointRegistry {
  constructor({
    endpoints = [],
    durableStore = null,
    durableState = null,
    now = Date.now,
  } = {}) {
    this.durableStore = durableStore;
    this.now = now;
    this.sequence = 0;
    const restoredState = durableState || durableStore?.load?.() || {};
    const restoredEndpoints = recordsFromState(restoredState.endpoints);
    const sourceEndpoints = endpoints.length ? endpoints : restoredEndpoints;
    this.endpoints = new Map();
    for (const endpoint of sourceEndpoints) {
      const normalized = normalizeEndpointRecord(endpoint);
      this.endpoints.set(normalized.id, normalized);
    }
  }

  snapshot() {
    return {
      endpoints: [...this.endpoints.values()].map((record) => endpointView(record)),
    };
  }

  persist() {
    if (this.durableStore && typeof this.durableStore.save === 'function') {
      this.durableStore.save(this.snapshot());
    }
  }

  register(endpoint) {
    const normalized = normalizeEndpointRecord(endpoint);
    this.endpoints.set(normalized.id, normalized);
    this.persist();
    return endpointView(normalized);
  }

  list({ includeUnavailable = true } = {}) {
    return [...this.endpoints.values()]
      .filter((endpoint) => includeUnavailable || endpoint.available !== false)
      .map((endpoint) => endpointView(endpoint));
  }

  discover({
    capabilities = [],
    minTrustLevel = 'public',
    requireStreaming = false,
  } = {}) {
    const requiredCapabilities = new Set(normalizeList(capabilities));
    const minTrustRank = getTrustRank(minTrustLevel);
    return [...this.endpoints.values()]
      .filter((endpoint) => endpoint.available !== false)
      .filter((endpoint) => endpoint.trustRank >= minTrustRank)
      .filter((endpoint) => !requireStreaming || endpoint.supportsStreaming)
      .filter((endpoint) => [...requiredCapabilities].every((capability) => endpoint.capabilities.includes(capability)))
      .sort((left, right) => (
        right.trustRank - left.trustRank
        || left.id.localeCompare(right.id)
      ))
      .map((endpoint) => endpointView(endpoint));
  }

  get(agentId) {
    const endpoint = this.endpoints.get(String(agentId || ''));
    if (!endpoint) throw new Error(`Unknown A2A endpoint ${agentId || '(empty)'}`);
    return endpoint;
  }

  buildNegotiationEnvelope({
    from = 'helios.sidecar',
    toAgentId,
    task = {},
    requestedCapabilities,
    parentMessageId,
    rootMessageId,
    lineage = [],
  } = {}) {
    const endpoint = this.get(toAgentId);
    const requested = normalizeList(requestedCapabilities || task.requiredCapabilities);
    const missingCapabilities = requested.filter((capability) => !endpoint.capabilities.includes(capability));
    if (missingCapabilities.length) {
      throw new Error(`A2A endpoint ${endpoint.id} missing capabilities: ${missingCapabilities.join(', ')}`);
    }

    this.sequence += 1;
    const correlationId = String(task.correlationId || task.id || `a2a-negotiation-${this.sequence}`);
    const messageId = makeNegotiationId({ correlationId, sequence: this.sequence });
    const rootId = rootMessageId || parentMessageId || messageId;
    const lineageHops = normalizeLineage(lineage);
    const mutation = isMutationTask({ ...task, requiredCapabilities: requested });

    const currentHop = {
      messageId,
      parentMessageId,
      rootMessageId: rootId,
      from,
      to: endpoint.id,
      taskId: task.id,
      agentId: endpoint.id,
      endpointId: endpoint.endpointId,
    };

    return redactSecrets({
      protocol: 'a2a',
      version: '0.1',
      from,
      to: endpoint.id,
      endpoint: endpointView(endpoint),
      durable: {
        direction: 'outbox',
        messageId,
        parentMessageId,
        rootMessageId: rootId,
        correlationId,
        createdAt: this.now(),
        queueId: endpoint.queueId,
        lineage: [...lineageHops, currentHop],
      },
      message: {
        kind: 'delegation_negotiation',
        task: scopedTask(task, requested),
        requestedCapabilities: requested,
        negotiation: {
          mutation,
          approvalRequired: mutation,
          streamingAccepted: endpoint.supportsStreaming,
          restartPersistent: endpoint.restartPersistent,
          trust: {
            external: true,
            verified: false,
            claimedTrustLevel: endpoint.trustLevel,
          },
          authority: {
            canPromote: false,
            canMutateWorkspace: false,
            requiresVerifierEvidence: true,
          },
        },
      },
    });
  }
}
