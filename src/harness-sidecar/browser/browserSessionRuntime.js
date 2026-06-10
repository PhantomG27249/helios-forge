const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const SECRET_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-api-key|api-key|api_key|token)$/i;
const SECRET_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(authorization|cookie|set-cookie|x-api-key|api-key|api_key|token)\s*[:=]\s*[^,\s;]+/gi,
];

function sanitizeTaskId(taskId) {
  return String(taskId || 'session').replace(/[^A-Za-z0-9_-]+/g, '_');
}

function notFound(sessionId) {
  return {
    status: 'not_found',
    reason: 'browser_session_not_found',
    sessionId,
  };
}

function normalizeOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]' || normalized === '::1';
}

function isPrivateIpv4(hostname) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(hostname);
  if (!match) {
    return false;
  }
  const [, aRaw, bRaw] = match;
  const a = Number(aRaw);
  const b = Number(bRaw);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}

function sanitizeUrlForTrace(url) {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '[invalid_url]';
  }
}

function isUrlAllowedByPolicy(url, policy = {}) {
  if (typeof policy.assertBrowserUrlAllowed === 'function') {
    try {
      policy.assertBrowserUrlAllowed({ url, policy, reason: 'browser.navigate' });
      return { allowed: true };
    } catch (error) {
      return { allowed: false, reason: error?.reason || 'browser_url_policy_denied' };
    }
  }
  if (typeof policy.assertUrlAllowed === 'function') {
    try {
      policy.assertUrlAllowed({ url, reason: 'browser.navigate' });
      return { allowed: true };
    } catch (error) {
      return { allowed: false, reason: error?.reason || 'browser_url_policy_denied' };
    }
  }
  if (typeof policy.isUrlAllowed === 'function') {
    return policy.isUrlAllowed({ url }) === true
      ? { allowed: true }
      : { allowed: false, reason: 'browser_url_policy_denied' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'browser_url_policy_denied' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { allowed: false, reason: 'browser_url_policy_denied' };
  }
  if (isLoopbackHostname(parsed.hostname)) {
    return { allowed: true };
  }
  if (isPrivateIpv4(parsed.hostname)) {
    return { allowed: false, reason: 'browser_url_policy_denied' };
  }

  const allowedOrigins = new Set((policy.allowedOrigins || []).map(normalizeOrigin).filter(Boolean));
  return allowedOrigins.has(parsed.origin)
    ? { allowed: true }
    : { allowed: false, reason: 'browser_url_policy_denied' };
}

function redactText(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_TEXT_PATTERNS) {
    text = text.replace(pattern, '[redacted]');
  }
  return text;
}

function sanitizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [
      key,
      SECRET_HEADER_PATTERN.test(key) ? '[redacted]' : redactText(value),
    ]),
  );
}

function sanitizeConsoleEntry(entry = {}) {
  return {
    type: entry.type || entry.level || 'log',
    text: redactText(entry.text ?? entry.message ?? ''),
    url: entry.url ? sanitizeUrlForTrace(entry.url) : undefined,
    timestamp: entry.timestamp,
  };
}

function sanitizeNetworkRecord(record = {}) {
  return {
    method: record.method,
    url: record.url ? sanitizeUrlForTrace(record.url) : undefined,
    status: record.status,
    requestHeaders: sanitizeHeaders(record.requestHeaders || record.headers),
    responseHeaders: sanitizeHeaders(record.responseHeaders),
    failure: record.failure,
    resourceType: record.resourceType,
  };
}

function emit(emitEvent, event) {
  if (typeof emitEvent === 'function') {
    emitEvent(event);
  }
}

export function createBrowserSessionRuntime({
  workspaceRoot,
  adapter,
  policy = {},
  emitEvent,
} = {}) {
  const sessions = new Map();
  let counter = 0;

  function getSession(sessionId) {
    return sessions.get(sessionId);
  }

  return {
    async createSession({ taskId, viewport = DEFAULT_VIEWPORT } = {}) {
      if (!adapter || adapter.status === 'unavailable' || typeof adapter.createSession !== 'function') {
        return { status: 'unavailable', reason: 'browser_runtime_required' };
      }

      counter += 1;
      const sessionId = `browser_${sanitizeTaskId(taskId)}_${counter}`;
      const sessionPolicy = policy;
      const adapterSession = await adapter.createSession({
        sessionId,
        taskId,
        workspaceRoot,
        viewport,
        policy: sessionPolicy,
      });
      if (adapterSession?.status === 'unavailable') {
        return adapterSession;
      }

      const state = {
        sessionId,
        taskId,
        viewport,
        policy: sessionPolicy,
        adapterSession,
      };
      sessions.set(sessionId, state);

      emit(emitEvent, {
        type: 'browser.session_started',
        sessionId,
        taskId,
        viewport,
      });

      return {
        status: adapterSession?.status || 'ready',
        sessionId,
        taskId,
        viewport: adapterSession?.viewport || viewport,
      };
    },

    async navigate({ sessionId, url } = {}) {
      const session = getSession(sessionId);
      if (!session) {
        return notFound(sessionId);
      }

      const policyResult = isUrlAllowedByPolicy(url, session.policy);
      if (!policyResult.allowed) {
        return {
          status: 'denied',
          reason: policyResult.reason || 'browser_url_policy_denied',
          sessionId,
          url: sanitizeUrlForTrace(url),
        };
      }

      const result = await adapter.navigate(session.adapterSession, { url, sessionId });
      const sanitizedUrl = sanitizeUrlForTrace(result?.url || url);
      emit(emitEvent, {
        type: 'browser.navigation',
        sessionId,
        url: sanitizedUrl,
        status: result?.status || 'navigated',
      });
      return {
        status: result?.status || 'navigated',
        sessionId,
        url: sanitizedUrl,
        title: result?.title,
      };
    },

    async screenshot({ sessionId, outputPath } = {}) {
      const session = getSession(sessionId);
      if (!session) {
        return notFound(sessionId);
      }

      const result = await adapter.screenshot(session.adapterSession, { outputPath, sessionId });
      const captured = {
        status: result?.status || 'captured',
        sessionId,
        path: result?.path || result?.imagePath || outputPath,
        width: result?.width || session.viewport.width,
        height: result?.height || session.viewport.height,
      };
      emit(emitEvent, {
        type: 'browser.screenshot_captured',
        sessionId,
        path: captured.path,
        width: captured.width,
        height: captured.height,
      });
      return captured;
    },

    async consoleRead({ sessionId } = {}) {
      const session = getSession(sessionId);
      if (!session) {
        return notFound(sessionId);
      }

      const entries = await adapter.consoleRead(session.adapterSession, { sessionId });
      const sanitized = (entries || []).map(sanitizeConsoleEntry);
      emit(emitEvent, {
        type: 'browser.console_read',
        sessionId,
        count: sanitized.length,
      });
      return {
        status: 'completed',
        sessionId,
        entries: sanitized,
      };
    },

    async networkSummary({ sessionId } = {}) {
      const session = getSession(sessionId);
      if (!session) {
        return notFound(sessionId);
      }

      const records = await adapter.networkSummary(session.adapterSession, { sessionId });
      const sanitized = (records || []).map(sanitizeNetworkRecord);
      emit(emitEvent, {
        type: 'browser.network_summary',
        sessionId,
        count: sanitized.length,
      });
      return {
        status: 'completed',
        sessionId,
        records: sanitized,
      };
    },

    async domSnapshot({ sessionId } = {}) {
      const session = getSession(sessionId);
      if (!session) {
        return notFound(sessionId);
      }

      const result = await adapter.domSnapshot(session.adapterSession, { sessionId });
      return {
        status: result?.status || 'captured',
        sessionId,
        text: result?.text || '',
        roles: result?.roles || [],
      };
    },

    async closeSession({ sessionId } = {}) {
      const session = getSession(sessionId);
      if (!session) {
        return notFound(sessionId);
      }

      await adapter.closeSession(session.adapterSession, { sessionId });
      sessions.delete(sessionId);
      emit(emitEvent, {
        type: 'browser.session_closed',
        sessionId,
      });
      return {
        status: 'closed',
        sessionId,
      };
    },
  };
}
