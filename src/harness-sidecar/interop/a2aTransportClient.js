import { buildA2AStreamEnvelope } from './a2aSwarmEnvelope.js';

function trimBaseUrl(baseUrl = '') {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function headersWithAuth(authToken, headers = {}) {
  return {
    'content-type': 'application/json',
    ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    ...headers,
  };
}

async function parseResponse(response) {
  const body = typeof response.json === 'function' ? await response.json() : response.body;
  if (!response.ok) {
    const reason = body?.reason || body?.error || `http_${response.status}`;
    const error = new Error(`A2A transport request failed: ${reason}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export function createA2ATransportClient({
  baseUrl,
  fetchAdapter = globalThis.fetch,
  authToken,
  headers = {},
} = {}) {
  if (!baseUrl) throw new Error('A2A transport client requires a baseUrl');
  if (typeof fetchAdapter !== 'function') {
    throw new Error('A2A transport client requires a fetch adapter');
  }
  const normalizedBaseUrl = trimBaseUrl(baseUrl);

  async function post(path, body) {
    const response = await fetchAdapter(`${normalizedBaseUrl}${path}`, {
      method: 'POST',
      headers: headersWithAuth(authToken, headers),
      body: JSON.stringify(body || {}),
    });
    return parseResponse(response);
  }

  return {
    handshake({ peer = {} } = {}) {
      return post('/handshake', { peer });
    },

    submitMessage({ envelope } = {}) {
      return post('/messages', { envelope });
    },

    reportProgress({ messageId, percent, detail, payload, peerId, from } = {}) {
      return post('/messages/progress', { messageId, percent, detail, payload, peerId, from });
    },

    cancelMessage({ messageId, reason, peerId, from } = {}) {
      return post('/messages/cancel', { messageId, reason, peerId, from });
    },

    retryOutbox({ limit } = {}) {
      return post('/outbox/retry', { limit });
    },

    sendStreamEnvelope({
      envelope,
      streamId,
      sequence = 0,
      correlationId,
      from,
      to,
      event = 'chunk',
      payload = {},
      progress,
      cancellation,
      done = false,
    } = {}) {
      const streamEnvelope = envelope || buildA2AStreamEnvelope({
        streamId,
        sequence,
        correlationId,
        from,
        to,
        event,
        payload,
        progress,
        cancellation,
        done,
      });
      return post('/streams', { envelope: streamEnvelope });
    },
  };
}
