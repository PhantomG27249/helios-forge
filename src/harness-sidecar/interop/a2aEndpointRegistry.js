import { getTrustRank, normalizeAgentCard, redactSecrets } from './agentCards.js';
import { normalizeA2aLineage } from './a2aMultiHopLineage.js';

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

function normalizePositiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return Math.floor(number);
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

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => (
      item !== undefined
      && !(Array.isArray(item) && item.length === 0)
      && !(item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 0)
    )),
  );
}

function normalizeTier(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || undefined;
}

function normalizeModelCapabilities(modelCapabilities = {}) {
  if (!modelCapabilities || typeof modelCapabilities !== 'object' || Array.isArray(modelCapabilities)) {
    return {};
  }
  return compactObject({
    profiles: normalizeList(modelCapabilities.profiles),
    supportsVision: modelCapabilities.supportsVision === undefined
      ? undefined
      : Boolean(modelCapabilities.supportsVision),
    maxContextTokens: normalizePositiveInteger(modelCapabilities.maxContextTokens),
    costTier: normalizeTier(modelCapabilities.costTier),
    latencyTier: normalizeTier(modelCapabilities.latencyTier),
    preferredRoles: normalizeList(modelCapabilities.preferredRoles),
    unavailableProfiles: normalizeList(modelCapabilities.unavailableProfiles),
  });
}

function isContractSecretKey(key) {
  return /authorization|token|secret|password|passwd|api[_-]?key|credential|private/i.test(key)
    && !/keyRef$/i.test(key);
}

function redactContractValue(value, parentKey = '') {
  if (/keyRef$/i.test(parentKey)) return String(value || '').trim();
  if (isContractSecretKey(parentKey)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactContractValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        redactContractValue(nestedValue, key),
      ]),
    );
  }
  return sanitizeExternalPayload(value);
}

function normalizeContract(contract = {}) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return {};
  const normalized = redactContractValue({
    version: String(contract.version || '0.1').trim(),
    transports: normalizeList(contract.transports),
    queues: contract.queues && typeof contract.queues === 'object' ? contract.queues : {},
    auth: contract.auth && typeof contract.auth === 'object' ? contract.auth : {},
    streaming: contract.streaming && typeof contract.streaming === 'object' ? contract.streaming : {},
    heartbeat: contract.heartbeat && typeof contract.heartbeat === 'object' ? contract.heartbeat : {},
    metadata: contract.metadata && typeof contract.metadata === 'object' ? contract.metadata : {},
  });
  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => (
      value !== undefined
      && !(Array.isArray(value) && value.length === 0)
      && !(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
    )),
  );
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
    contract: normalizeContract(record.contract || record.endpointContract),
    modelCapabilities: normalizeModelCapabilities(record.modelCapabilities),
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
    contract: record.contract,
    modelCapabilities: record.modelCapabilities,
    metadata: record.metadata,
  });
}

function normalizeLineage(lineage = []) {
  return normalizeA2aLineage(recordsFromState(lineage)
    .filter((hop) => hop && typeof hop === 'object' && !Array.isArray(hop)))
    .map((hop) => redactSecrets({
      messageId: hop.messageId,
      parentMessageId: hop.parentMessageId,
      rootMessageId: hop.rootMessageId,
      from: hop.from,
      to: hop.to,
      taskId: hop.taskId,
      agentId: hop.agentId,
      endpointId: hop.endpointId,
      trust: hop.trust,
    }));
}

function makeNegotiationId({ correlationId, sequence }) {
  return `neg_${String(correlationId || 'task').replace(/[^A-Za-z0-9_.:-]/g, '_')}_${sequence}`;
}

function makeNegotiationResponseId({ correlationId, parentMessageId }) {
  return `neg_resp_${String(correlationId || parentMessageId || 'task').replace(/[^A-Za-z0-9_.:-]/g, '_')}`;
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

function sanitizeNegotiationTerms(terms = {}) {
  if (!terms || typeof terms !== 'object' || Array.isArray(terms)) return {};
  return sanitizeExternalPayload(redactSecrets(Object.fromEntries(
    Object.entries(terms)
      .filter(([key]) => !/promotion|promotional|marketing|claim/i.test(key)),
  )));
}

function sanitizeModelCapabilityFilter(modelCapability = {}) {
  if (!modelCapability || typeof modelCapability !== 'object' || Array.isArray(modelCapability)) return {};
  return compactObject({
    profiles: normalizeList(
      modelCapability.profiles
      || modelCapability.preferredProfiles
      || modelCapability.profile,
    ),
    excludedProfiles: normalizeList(modelCapability.excludedProfiles),
    supportsVision: modelCapability.supportsVision === undefined
      ? undefined
      : Boolean(modelCapability.supportsVision),
    minContextTokens: normalizePositiveInteger(modelCapability.minContextTokens),
    costTier: normalizeTier(modelCapability.costTier),
    latencyTier: normalizeTier(modelCapability.latencyTier),
  });
}

function endpointMatchesModelCapability(endpoint, modelCapability = {}) {
  const filter = sanitizeModelCapabilityFilter(modelCapability);
  if (Object.keys(filter).length === 0) return true;
  const capabilities = endpoint.modelCapabilities || {};
  const unavailable = new Set(normalizeList(capabilities.unavailableProfiles));
  const profiles = normalizeList(capabilities.profiles)
    .filter((profile) => !unavailable.has(profile));
  const excluded = new Set(normalizeList(filter.excludedProfiles));
  const eligibleProfiles = profiles.filter((profile) => !excluded.has(profile));
  if (filter.profiles?.length && !filter.profiles.some((profile) => eligibleProfiles.includes(profile))) {
    return false;
  }
  if (filter.supportsVision === true && capabilities.supportsVision !== true) return false;
  if (
    filter.supportsVision === false
    && capabilities.supportsVision !== undefined
    && capabilities.supportsVision !== false
  ) {
    return false;
  }
  if (filter.minContextTokens && Number(capabilities.maxContextTokens || 0) < filter.minContextTokens) {
    return false;
  }
  if (filter.costTier && capabilities.costTier !== filter.costTier) return false;
  if (filter.latencyTier && capabilities.latencyTier !== filter.latencyTier) return false;
  return true;
}

function endpointMatchesRole(endpoint, role) {
  const normalizedRole = String(role || '').trim();
  if (!normalizedRole) return true;
  return normalizeList(endpoint.modelCapabilities?.preferredRoles).includes(normalizedRole);
}

function normalizeModelPreferenceRequiredCapabilities(requiredCapabilities = {}) {
  if (!requiredCapabilities || typeof requiredCapabilities !== 'object' || Array.isArray(requiredCapabilities)) {
    return {};
  }
  return compactObject({
    minContextTokens: normalizePositiveInteger(requiredCapabilities.minContextTokens),
    maxContextTokens: normalizePositiveInteger(requiredCapabilities.maxContextTokens),
    supportsVision: requiredCapabilities.supportsVision === undefined
      ? undefined
      : Boolean(requiredCapabilities.supportsVision),
    costTier: normalizeTier(requiredCapabilities.costTier),
    latencyTier: normalizeTier(requiredCapabilities.latencyTier),
    profiles: normalizeList(requiredCapabilities.profiles),
    capabilities: normalizeList(requiredCapabilities.capabilities),
  });
}

function normalizeModelPreference({ modelPreference = {}, task = {} } = {}) {
  const source = modelPreference && typeof modelPreference === 'object' && !Array.isArray(modelPreference)
    ? modelPreference
    : {};
  if (Object.keys(source).length === 0) return undefined;
  return compactObject(sanitizeExternalPayload({
    role: source.role ? String(source.role).trim() : undefined,
    taskType: source.taskType || task.taskType || task.type
      ? String(source.taskType || task.taskType || task.type).trim()
      : undefined,
    preferredProfiles: normalizeList(source.preferredProfiles || source.profiles),
    excludedProfiles: normalizeList(source.excludedProfiles),
    requiredCapabilities: normalizeModelPreferenceRequiredCapabilities(source.requiredCapabilities),
    authority: 'evidence_only',
    canPromote: false,
  }));
}

function normalizeModelNegotiation(modelNegotiation = {}) {
  if (!modelNegotiation || typeof modelNegotiation !== 'object' || Array.isArray(modelNegotiation)) {
    return undefined;
  }
  if (Object.keys(modelNegotiation).length === 0) return undefined;
  return compactObject(sanitizeExternalPayload(redactSecrets({
    acceptedProfile: modelNegotiation.acceptedProfile
      ? String(modelNegotiation.acceptedProfile).trim()
      : undefined,
    fallbackProfiles: normalizeList(modelNegotiation.fallbackProfiles),
    reasons: normalizeList(modelNegotiation.reasons),
    authority: 'evidence_only',
    canPromote: false,
  })));
}

export function buildA2ANegotiationResponseEnvelope({
  from,
  to,
  accepted = false,
  acceptedCapabilities = [],
  terms = {},
  modelNegotiation,
  requestEnvelope = {},
} = {}) {
  const durable = requestEnvelope.durable || {};
  const parentMessageId = String(durable.messageId || requestEnvelope.message?.messageId || '');
  const correlationId = String(durable.correlationId || requestEnvelope.message?.correlationId || parentMessageId || 'negotiation');
  const rootMessageId = String(durable.rootMessageId || parentMessageId || correlationId);
  const messageId = makeNegotiationResponseId({ correlationId, parentMessageId });
  const lineageHops = normalizeLineage(durable.lineage);
  const currentHop = {
    messageId,
    parentMessageId,
    rootMessageId,
    from: String(from || ''),
    to: String(to || requestEnvelope.from || ''),
    taskId: requestEnvelope.message?.task?.id,
    agentId: String(from || ''),
    endpointId: String(from || ''),
  };
  const claimedTrustLevel = String(terms.claimedTrustLevel || 'public').trim().toLowerCase();

  const normalizedModelNegotiation = normalizeModelNegotiation(modelNegotiation || terms.modelNegotiation);

  return redactSecrets({
    protocol: 'a2a',
    version: '0.1',
    from: String(from || ''),
    to: String(to || requestEnvelope.from || ''),
    durable: {
      direction: 'outbox',
      messageId,
      parentMessageId,
      rootMessageId,
      correlationId,
      lineage: [...lineageHops, currentHop],
    },
    message: {
      kind: 'delegation_negotiation_response',
      accepted: Boolean(accepted),
      acceptedCapabilities: normalizeList(acceptedCapabilities),
      terms: sanitizeNegotiationTerms(terms),
      trust: {
        external: true,
        verified: false,
        claimedTrustLevel,
      },
      authority: {
        canPromote: false,
        canMutateWorkspace: false,
        requiresVerifierEvidence: true,
      },
      ...(normalizedModelNegotiation ? { modelNegotiation: normalizedModelNegotiation } : {}),
    },
  });
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
    role,
    modelCapability,
    modelPreference,
  } = {}) {
    const requiredCapabilities = new Set(normalizeList(capabilities));
    const minTrustRank = getTrustRank(minTrustLevel);
    const capabilityFilter = modelCapability || modelPreference;
    return [...this.endpoints.values()]
      .filter((endpoint) => endpoint.available !== false)
      .filter((endpoint) => endpoint.trustRank >= minTrustRank)
      .filter((endpoint) => !requireStreaming || endpoint.supportsStreaming)
      .filter((endpoint) => [...requiredCapabilities].every((capability) => endpoint.capabilities.includes(capability)))
      .filter((endpoint) => endpointMatchesRole(endpoint, role || modelPreference?.role))
      .filter((endpoint) => endpointMatchesModelCapability(endpoint, capabilityFilter))
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

  describeEndpoint(agentId) {
    return endpointView(this.get(agentId));
  }

  buildNegotiationEnvelope({
    from = 'helios.sidecar',
    toAgentId,
    task = {},
    requestedCapabilities,
    parentMessageId,
    rootMessageId,
    lineage = [],
    modelPreference,
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
    const normalizedModelPreference = normalizeModelPreference({
      modelPreference: modelPreference || task.modelPreference,
      task,
    });

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

    const envelope = redactSecrets({
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
        ...(normalizedModelPreference ? { modelPreference: normalizedModelPreference } : {}),
      },
    });
    if (normalizedModelPreference) envelope.message.modelPreference = normalizedModelPreference;
    return envelope;
  }
}
