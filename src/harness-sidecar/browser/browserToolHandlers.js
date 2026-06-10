import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  assertBrowserUrlAllowed,
  createBrowserPolicy,
  sanitizeNetworkRecord,
  sanitizeUrlForBrowserTrace,
} from './browserPolicy.js';
import {
  resolveBrowserArtifactPath,
  summarizeBrowserArtifact,
} from './browserArtifacts.js';

const DEFAULT_DOM_TEXT_LIMIT = 12000;
const DEFAULT_NETWORK_LIMIT = 100;
const DEFAULT_CONSOLE_LIMIT = 200;
const SECRET_TEXT_PATTERNS = [
  /\b(password|authorization|cookie|cookies|set-cookie|x-api-key|api-key|api_key|token)\s*[:=]\s*(?:Bearer\s+)?[^,\s;&]+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

function runtimeRequired(method) {
  return {
    status: 'unavailable',
    reason: 'browser_runtime_required',
    method,
  };
}

function callRuntime(browserRuntime, method, args) {
  const fn = browserRuntime?.[method];
  if (typeof fn !== 'function') {
    return runtimeRequired(method);
  }
  return fn.call(browserRuntime, args);
}

function validateUrl({ url, policy, reason }) {
  if (!url) {
    return {
      allowed: false,
      reason: 'browser_url_required',
      url: sanitizeUrlForBrowserTrace(url),
    };
  }

  if (typeof policy?.validateUrl === 'function') {
    const result = policy.validateUrl({ url, reason });
    if (result === true || result?.allowed === true) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: result?.reason || 'browser_url_policy_denied',
      url: result?.sanitizedUrl || result?.url || sanitizeUrlForBrowserTrace(url),
    };
  }

  if (typeof policy?.isUrlAllowed === 'function') {
    const result = policy.isUrlAllowed({ url, reason });
    if (result === true || result?.allowed === true) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: result?.reason || 'browser_url_policy_denied',
      url: result?.sanitizedUrl || result?.url || sanitizeUrlForBrowserTrace(url),
    };
  }

  try {
    assertBrowserUrlAllowed({ url, policy, reason });
    return { allowed: true };
  } catch (error) {
    return {
      allowed: false,
      reason: error?.causeCode || error?.reason || error?.code || 'browser_url_policy_denied',
      url: error?.url || sanitizeUrlForBrowserTrace(url),
      message: error?.message,
    };
  }
}

function policyDenied(result) {
  return {
    status: 'denied',
    kind: 'policy',
    reason: result.reason || 'browser_url_policy_denied',
    url: result.url,
    message: result.message,
  };
}

function takeBounded(values, limit) {
  return Array.isArray(values) ? values.slice(0, limit) : [];
}

function clampTextLimit(maxTextChars = DEFAULT_DOM_TEXT_LIMIT) {
  const requested = Number(maxTextChars);
  if (!Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_DOM_TEXT_LIMIT;
  }
  return Math.min(Math.floor(requested), DEFAULT_DOM_TEXT_LIMIT);
}

function redactSecretText(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_TEXT_PATTERNS) {
    text = text.replace(pattern, '[redacted]');
  }
  return text;
}

function sanitizeConsoleEntry(entry = {}) {
  return {
    type: entry.type || entry.level || 'log',
    text: redactSecretText(entry.text ?? entry.message ?? '').slice(0, 4000),
    url: entry.url ? sanitizeUrlForBrowserTrace(entry.url) : undefined,
    timestamp: entry.timestamp,
  };
}

function sanitizeDomSnapshot(result = {}, maxTextChars = DEFAULT_DOM_TEXT_LIMIT) {
  const snapshot = result.snapshot && typeof result.snapshot === 'object' ? result.snapshot : result;
  const limit = clampTextLimit(maxTextChars);
  return {
    status: result.status || 'completed',
    sessionId: result.sessionId,
    text: redactSecretText(snapshot.text ?? '').slice(0, limit),
    roles: Array.isArray(snapshot.roles) ? snapshot.roles.slice(0, 200) : [],
    title: snapshot.title,
    url: snapshot.url ? sanitizeUrlForBrowserTrace(snapshot.url) : undefined,
  };
}

function browserToolSchema(properties = {}, required = []) {
  return {
    type: 'object',
    properties,
    required,
  };
}

export function registerBrowserTools({
  registry,
  workspaceRoot,
  browserRuntime,
  browserPolicy,
  emitEvent = () => {},
  options = {},
} = {}) {
  if (!registry) {
    throw new Error('registry is required');
  }
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }

  const sessionPolicies = new Map();
  const basePolicy = browserPolicy || createBrowserPolicy(options.policy || {});

  registry.register({
    name: 'browser.session.create',
    description: 'Create a policy-scoped browser session for a task.',
    risk: 'medium',
    inputSchema: browserToolSchema({
      taskId: { type: 'string' },
      viewport: { type: 'object' },
    }, ['taskId']),
    execute: async ({ taskId, viewport } = {}) => {
      const result = await callRuntime(browserRuntime, 'createSession', {
        taskId,
        viewport,
      });
      if (result?.sessionId) {
        sessionPolicies.set(result.sessionId, basePolicy);
      }
      return result;
    },
  });

  registry.register({
    name: 'browser.navigate',
    description: 'Navigate an existing browser session to a policy-allowed URL.',
    risk: 'medium',
    inputSchema: browserToolSchema({
      sessionId: { type: 'string' },
      url: { type: 'string' },
    }, ['sessionId', 'url']),
    execute: async ({ sessionId, url } = {}) => {
      const policy = sessionPolicies.get(sessionId) || basePolicy;
      const policyResult = validateUrl({ url, policy, reason: 'browser.navigate' });
      if (!policyResult.allowed) {
        return policyDenied(policyResult);
      }
      return callRuntime(browserRuntime, 'navigate', { sessionId, url });
    },
  });

  registry.register({
    name: 'browser.screenshot',
    description: 'Capture a browser screenshot artifact inside the task browser directory.',
    risk: 'medium',
    inputSchema: browserToolSchema({
      taskId: { type: 'string' },
      sessionId: { type: 'string' },
      filename: { type: 'string' },
      targetPath: { type: 'string' },
      outputPath: { type: 'string' },
    }, ['taskId', 'sessionId']),
    execute: async ({
      taskId,
      sessionId,
      filename,
      targetPath,
      outputPath,
    } = {}) => {
      const resolvedOutputPath = resolveBrowserArtifactPath({
        workspaceRoot,
        taskId,
        targetPath: outputPath || targetPath || filename,
        defaultName: 'screenshot.png',
        label: 'browser screenshot',
      });
      await mkdir(path.dirname(resolvedOutputPath), { recursive: true });

      const result = await callRuntime(browserRuntime, 'screenshot', {
        taskId,
        sessionId,
        outputPath: resolvedOutputPath,
      });
      if (result?.status === 'unavailable' || result?.status === 'not_found') {
        return result;
      }

      const artifactPath = result?.path || result?.imagePath || resolvedOutputPath;
      const artifact = summarizeBrowserArtifact({
        workspaceRoot,
        taskId,
        type: 'screenshot',
        path: artifactPath,
        metadata: {
          width: result?.width,
          height: result?.height,
          sessionId,
        },
      });
      await emitEvent({
        type: 'browser.tool.screenshot',
        taskId,
        sessionId,
        artifact,
      });

      return {
        ...result,
        outputPath: resolvedOutputPath,
        artifact,
      };
    },
  });

  registry.register({
    name: 'browser.console.read',
    description: 'Read bounded sanitized console entries for a browser session.',
    risk: 'low',
    inputSchema: browserToolSchema({
      sessionId: { type: 'string' },
      limit: { type: 'number' },
    }, ['sessionId']),
    execute: async ({ sessionId, limit = DEFAULT_CONSOLE_LIMIT } = {}) => {
      const result = await callRuntime(browserRuntime, 'consoleRead', { sessionId });
      if (!result?.entries) return result;
      return {
        ...result,
        entries: takeBounded(result.entries, limit).map(sanitizeConsoleEntry),
      };
    },
  });

  registry.register({
    name: 'browser.network.summary',
    description: 'Read bounded sanitized network records for a browser session.',
    risk: 'low',
    inputSchema: browserToolSchema({
      sessionId: { type: 'string' },
      limit: { type: 'number' },
    }, ['sessionId']),
    execute: async ({ sessionId, limit = DEFAULT_NETWORK_LIMIT } = {}) => {
      const result = await callRuntime(browserRuntime, 'networkSummary', { sessionId });
      const records = Array.isArray(result) ? result : result?.records;
      if (!records) return result;
      return {
        ...(Array.isArray(result) ? { status: 'completed', sessionId } : result),
        records: takeBounded(records, limit).map(sanitizeNetworkRecord),
      };
    },
  });

  registry.register({
    name: 'browser.dom.snapshot',
    description: 'Capture a bounded DOM text and role summary for a browser session.',
    risk: 'low',
    inputSchema: browserToolSchema({
      sessionId: { type: 'string' },
      maxTextChars: { type: 'number' },
    }, ['sessionId']),
    execute: async ({ sessionId, maxTextChars = DEFAULT_DOM_TEXT_LIMIT } = {}) => {
      const result = await callRuntime(browserRuntime, 'domSnapshot', { sessionId });
      if (result?.status === 'unavailable' || result?.status === 'not_found') {
        return result;
      }
      return sanitizeDomSnapshot(result, maxTextChars);
    },
  });

  registry.register({
    name: 'browser.session.close',
    description: 'Close a browser session and release runtime resources.',
    risk: 'low',
    inputSchema: browserToolSchema({
      sessionId: { type: 'string' },
    }, ['sessionId']),
    execute: async ({ sessionId } = {}) => {
      const result = await callRuntime(browserRuntime, 'closeSession', { sessionId });
      if (result?.status === 'closed' || result?.status === 'not_found') {
        sessionPolicies.delete(sessionId);
      }
      return result;
    },
  });

  return registry;
}
