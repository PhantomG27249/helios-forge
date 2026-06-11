import { buildA2AStreamEnvelope } from './a2aSwarmEnvelope.js';
import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

function cloneSerializable(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeMethod(method = 'POST') {
  return String(method || 'POST').trim().toUpperCase();
}

function normalizePath(path = '/') {
  const value = String(path || '/').split('?')[0];
  if (value.endsWith('/handshake')) return '/handshake';
  if (value.endsWith('/messages')) return '/messages';
  if (value.endsWith('/messages/progress')) return '/messages/progress';
  if (value.endsWith('/messages/cancel')) return '/messages/cancel';
  if (value.endsWith('/outbox/retry')) return '/outbox/retry';
  if (value.endsWith('/streams')) return '/streams';
  return value || '/';
}

function headerValue(headers = {}, name) {
  const target = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === target) return String(value || '');
  }
  return '';
}

function bearerToken(headers = {}) {
  const authorization = headerValue(headers, 'authorization');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function payloadSize(value) {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}

function response(status, body = {}) {
  return { status, body };
}

function normalizeScopes(scopes = []) {
  const source = scopes && typeof scopes === 'object' && !Array.isArray(scopes)
    ? scopes.scopes || scopes.scope || []
    : scopes;
  const list = Array.isArray(source) ? source : [source];
  return list.map((scope) => String(scope || '').trim()).filter(Boolean);
}

function hasTokenScopes(tokenScopes = {}) {
  return tokenScopes && typeof tokenScopes === 'object' && Object.keys(tokenScopes).length > 0;
}

function authorize(headers, tokenScopes, requiredScope) {
  if (!hasTokenScopes(tokenScopes)) return null;
  const token = bearerToken(headers);
  if (!token) return response(401, { ok: false, reason: 'missing_bearer_token' });
  const scopes = normalizeScopes(tokenScopes[token]);
  if (!scopes.includes(requiredScope)) {
    return response(403, { ok: false, reason: 'token_scope_denied', requiredScope });
  }
  return null;
}

function tokenPeerBinding(headers = {}, tokenScopes = {}) {
  if (!hasTokenScopes(tokenScopes)) return '';
  const entry = tokenScopes[bearerToken(headers)];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
  return String(entry.peerId || entry.agentId || '').trim();
}

function compactObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function normalizeTrustObject(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...source,
    external: true,
    verified: false,
  };
}

function normalizeInboundExternalClaims(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeInboundExternalClaims(item, parentKey));
  }
  if (!value || typeof value !== 'object') return value;

  const normalized = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'trust') {
      normalized[key] = normalizeTrustObject(child);
    } else {
      normalized[key] = normalizeInboundExternalClaims(child, key);
    }
  }

  if (
    parentKey === 'a2a'
    || Object.hasOwn(normalized, 'verified')
    || Object.hasOwn(normalized, 'external')
  ) {
    normalized.external = true;
    normalized.verified = false;
  }
  return normalized;
}

function isMutationCapability(capability) {
  return /\.(apply|write|update|delete|create|merge|exec)$/i.test(capability)
    || /^(patch|write|delete|create|merge|shell|exec)\b/i.test(capability);
}

function normalizeList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return list.map((value) => String(value || '').trim()).filter(Boolean);
}

function isExternalMutationEnvelope(envelope = {}) {
  const message = envelope.message || {};
  const task = message.task || envelope.task || {};
  if (message.mutation === true || message.mode === 'mutation') return true;
  if (task.mutation === true || task.mode === 'mutation') return true;
  return normalizeList(message.requiredCapabilities || task.requiredCapabilities)
    .some((capability) => isMutationCapability(capability));
}

function envelopeMessageId(envelope = {}) {
  return String(
    envelope.durable?.messageId
    || envelope.message?.messageId
    || envelope.message?.id
    || '',
  );
}

function streamEnvelopeMessageId(envelope = {}) {
  return String(
    envelope.durable?.messageId
    || envelope.message?.messageId
    || '',
  );
}

function outboxRecordFor(gateway, messageId) {
  const id = String(messageId || '');
  if (!id) return null;
  if (typeof gateway.getOutboxRecord === 'function') return gateway.getOutboxRecord(id);
  const record = typeof gateway.findDurableRecord === 'function' ? gateway.findDurableRecord(id) : null;
  return record?.direction === 'outbox' ? record : null;
}

function controlPeerForRecord(record = {}) {
  return String(
    record.agentId
    || record.envelope?.agent?.id
    || record.envelope?.to
    || '',
  ).trim();
}

function annotateRecord(record, quarantine) {
  return {
    ...record,
    quarantine: {
      quarantined: quarantine.quarantined,
      reasons: quarantine.reasons,
      redacted: quarantine.redacted,
    },
  };
}

function sanitizeInboundEnvelope(envelope = {}, options = {}) {
  const withExternalClaims = normalizeInboundExternalClaims({
    protocol: 'a2a',
    version: '0.1',
    ...cloneSerializable(envelope),
  });
  if (!withExternalClaims.message || typeof withExternalClaims.message !== 'object') {
    withExternalClaims.message = {};
  }
  withExternalClaims.message.trust = normalizeTrustObject(withExternalClaims.message.trust);

  const quarantine = quarantineModelVisiblePayload(withExternalClaims, {
    maxStringLength: options.maxStringLength,
  });
  return {
    envelope: quarantine.value,
    quarantine,
  };
}

export function createA2ATransportServer({
  gateway,
  endpointId = 'helios.sidecar',
  tokenScopes = {},
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  listenerAdapter = null,
  maxStringLength = 4_000,
} = {}) {
  if (!gateway || typeof gateway.receiveEnvelope !== 'function') {
    throw new Error('A2A transport server requires an ExternalAgentGateway-compatible gateway');
  }

  const seenInboundMessageIds = new Set(
    typeof gateway.listInbox === 'function'
      ? gateway.listInbox().map((record) => record.messageId)
      : [],
  );
  const seenStreamMessageIds = new Set(
    typeof gateway.listStreams === 'function'
      ? gateway.listStreams().flatMap((stream) => (
        Array.isArray(stream.chunks)
          ? stream.chunks.map((chunk) => String(chunk.messageId || '')).filter(Boolean)
          : []
      ))
      : [],
  );

  function preflight({ method, path, headers, body }, requiredScope) {
    if (normalizeMethod(method) !== 'POST') {
      return response(405, { ok: false, reason: 'method_not_allowed' });
    }
    if (payloadSize(body) > maxPayloadBytes) {
      return response(413, { ok: false, reason: 'payload_too_large' });
    }
    return authorize(headers, tokenScopes, requiredScope) || null;
  }

  function messageControlDenied({ headers, body, record }) {
    if (!record) {
      return response(404, { ok: false, reason: 'unknown_message_id', messageId: String(body?.messageId || '') });
    }
    const expectedPeerId = controlPeerForRecord(record);
    if (!expectedPeerId) {
      return response(403, { ok: false, reason: 'message_peer_unbound', messageId: record.messageId });
    }
    const requestPeerId = String(
      body?.peerId
      || body?.from
      || headerValue(headers, 'x-a2a-peer-id')
      || '',
    ).trim();
    const boundPeerId = tokenPeerBinding(headers, tokenScopes);
    if (boundPeerId && requestPeerId && requestPeerId !== boundPeerId) {
      return response(403, { ok: false, reason: 'peer_token_mismatch', messageId: record.messageId });
    }
    const principalPeerId = boundPeerId || requestPeerId;
    if (!principalPeerId) {
      return response(403, { ok: false, reason: 'message_peer_required', messageId: record.messageId });
    }
    if (principalPeerId !== expectedPeerId) {
      return response(403, { ok: false, reason: 'message_peer_mismatch', messageId: record.messageId });
    }
    return null;
  }

  function handshake({ method, path, headers, body }) {
    const denied = preflight({ method, path, headers, body }, 'handshake');
    if (denied) return denied;
    const peer = body?.peer && typeof body.peer === 'object' ? body.peer : {};
    return response(200, {
      ok: true,
      accepted: true,
      endpointId,
      peerId: String(peer.id || ''),
      capabilities: normalizeList(peer.capabilities),
      supportsStreaming: peer.supportsStreaming !== false,
      trust: {
        external: true,
        verified: false,
      },
      authority: {
        canPromote: false,
        canMutateWorkspace: false,
      },
    });
  }

  function receiveMessage({ method, path, headers, body }) {
    const denied = preflight({ method, path, headers, body }, 'message:submit');
    if (denied) return denied;
    const envelope = body?.envelope || body;
    if (isExternalMutationEnvelope(envelope)) {
      return response(403, { ok: false, reason: 'external_mutation_blocked' });
    }
    const messageId = envelopeMessageId(envelope);
    if (!messageId) {
      return response(400, { ok: false, reason: 'stable_message_id_required' });
    }
    if (messageId && seenInboundMessageIds.has(messageId)) {
      return response(409, { ok: false, reason: 'message_replay', messageId });
    }
    const sanitized = sanitizeInboundEnvelope(envelope, { maxStringLength });
    const result = gateway.receiveEnvelope(sanitized.envelope);
    if (result.status === 'duplicate') {
      return response(409, { ok: false, reason: 'message_replay', messageId: result.record.messageId });
    }
    seenInboundMessageIds.add(result.record.messageId);
    return response(202, {
      ok: true,
      status: result.status,
      record: annotateRecord(result.record, sanitized.quarantine),
    });
  }

  function progress({ method, path, headers, body }) {
    const denied = preflight({ method, path, headers, body }, 'message:progress');
    if (denied) return denied;
    if (!body?.messageId) return response(400, { ok: false, reason: 'message_id_required' });
    const record = outboxRecordFor(gateway, body.messageId);
    const controlDenied = messageControlDenied({ headers, body, record });
    if (controlDenied) return controlDenied;
    const quarantine = quarantineModelVisiblePayload({
      detail: body?.detail,
      payload: normalizeInboundExternalClaims(body?.payload),
    }, { maxStringLength });
    const result = gateway.recordProgress({
      messageId: body?.messageId,
      percent: body?.percent,
      detail: quarantine.value.detail,
      payload: quarantine.value.payload,
    });
    return response(200, {
      ok: true,
      ...result,
      quarantine: {
        quarantined: quarantine.quarantined,
        reasons: quarantine.reasons,
        redacted: quarantine.redacted,
      },
    });
  }

  function cancel({ method, path, headers, body }) {
    const denied = preflight({ method, path, headers, body }, 'message:cancel');
    if (denied) return denied;
    if (!body?.messageId) return response(400, { ok: false, reason: 'message_id_required' });
    const record = outboxRecordFor(gateway, body.messageId);
    const controlDenied = messageControlDenied({ headers, body, record });
    if (controlDenied) return controlDenied;
    const quarantine = quarantineModelVisiblePayload({
      reason: body?.reason,
    }, { maxStringLength });
    const result = gateway.cancelMessage({
      messageId: body?.messageId,
      reason: quarantine.value.reason,
    });
    return response(200, {
      ok: true,
      ...result,
      quarantine: {
        quarantined: quarantine.quarantined,
        reasons: quarantine.reasons,
        redacted: quarantine.redacted,
      },
    });
  }

  async function retryOutbox({ method, path, headers, body }) {
    const denied = preflight({ method, path, headers, body }, 'message:submit');
    if (denied) return denied;
    const drained = await gateway.drainOutbox({ limit: body?.limit });
    return response(200, { ok: true, drained });
  }

  function receiveStream({ method, path, headers, body }) {
    const denied = preflight({ method, path, headers, body }, 'stream:write');
    if (denied) return denied;
    const sourceEnvelope = body?.envelope || buildA2AStreamEnvelope({
      streamId: body?.streamId,
      sequence: body?.sequence,
      correlationId: body?.correlationId,
      from: body?.from,
      to: endpointId,
      event: body?.event,
      payload: body?.payload,
      progress: body?.progress,
      cancellation: body?.cancellation,
      done: body?.done,
    });
    const messageId = streamEnvelopeMessageId(sourceEnvelope);
    if (!messageId) {
      return response(400, { ok: false, reason: 'stable_stream_message_id_required' });
    }
    if (seenStreamMessageIds.has(messageId)) {
      return response(409, { ok: false, reason: 'message_replay', messageId });
    }
    const sanitized = sanitizeInboundEnvelope(sourceEnvelope, { maxStringLength });
    const result = gateway.receiveStreamEnvelope(sanitized.envelope);
    seenStreamMessageIds.add(messageId);
    return response(202, compactObject({
      ok: true,
      ...result,
      quarantine: {
        quarantined: sanitized.quarantine.quarantined,
        reasons: sanitized.quarantine.reasons,
        redacted: sanitized.quarantine.redacted,
      },
    }));
  }

  function handle(request = {}) {
    const normalized = {
      method: request.method,
      path: normalizePath(request.path),
      headers: request.headers || {},
      body: request.body || {},
    };
    switch (normalized.path) {
      case '/handshake':
        return handshake(normalized);
      case '/messages':
        return receiveMessage(normalized);
      case '/messages/progress':
        return progress(normalized);
      case '/messages/cancel':
        return cancel(normalized);
      case '/outbox/retry':
        return retryOutbox(normalized);
      case '/streams':
        return receiveStream(normalized);
      default:
        return response(404, { ok: false, reason: 'not_found' });
    }
  }

  function start() {
    if (!listenerAdapter) return { started: false, reason: 'no_listener_adapter' };
    const contract = { endpointId, handle };
    if (typeof listenerAdapter.start === 'function') return listenerAdapter.start(contract);
    if (typeof listenerAdapter.listen === 'function') return listenerAdapter.listen(contract);
    throw new Error('A2A transport listener adapter must expose start() or listen()');
  }

  function stop() {
    if (listenerAdapter && typeof listenerAdapter.stop === 'function') {
      return listenerAdapter.stop();
    }
    return { stopped: true };
  }

  return {
    endpointId,
    gateway,
    handle,
    start,
    stop,
  };
}
