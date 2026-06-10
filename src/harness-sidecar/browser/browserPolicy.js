const DEFAULT_ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const BLOCKED_PROTOCOLS = new Set(['file:', 'data:', 'javascript:']);
const REDACTED = '[redacted]';
const INVALID_URL = '[invalid-url]';

const BODY_FIELD_NAMES = new Set([
  'body',
  'requestBody',
  'responseBody',
  'postData',
  'requestPostData',
  'responseText',
  'text',
]);

function normalizeOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function hostnameForPolicy(parsedUrl) {
  return parsedUrl.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function parseIPv4(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN;
    return Number(part);
  });
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isPrivateLanIPv4(hostname) {
  const octets = parseIPv4(hostname);
  if (!octets) return false;
  const [first, second] = octets;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function isSensitiveHeaderName(name) {
  const normalized = String(name).toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, '');
  return normalized === 'cookie'
    || normalized === 'set-cookie'
    || normalized === 'authorization'
    || normalized.includes('api-key')
    || compact.includes('apikey')
    || normalized.includes('token')
    || normalized.includes('secret');
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      isSensitiveHeaderName(name) ? REDACTED : value,
    ]),
  );
}

export function createBrowserPolicy(options = {}) {
  const allowedOrigins = new Set(
    (options.allowedOrigins || [])
      .map((origin) => normalizeOrigin(origin))
      .filter(Boolean),
  );

  return {
    allowedOrigins,
  };
}

export function assertBrowserUrlAllowed({ url, policy = createBrowserPolicy(), reason = 'browser_navigation' } = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throwBrowserUrlDenied({ url, reason, cause: 'malformed_url' });
  }

  if (BLOCKED_PROTOCOLS.has(parsedUrl.protocol) || !DEFAULT_ALLOWED_PROTOCOLS.has(parsedUrl.protocol)) {
    throwBrowserUrlDenied({ url, reason, cause: 'blocked_protocol' });
  }

  const hostname = hostnameForPolicy(parsedUrl);
  if (isLoopbackHostname(hostname)) {
    return { allowed: true, url: sanitizeUrlForBrowserTrace(parsedUrl.href), reason: 'loopback' };
  }

  if (isPrivateLanIPv4(hostname)) {
    throwBrowserUrlDenied({ url, reason, cause: 'private_lan_ipv4' });
  }

  if (policy.allowedOrigins?.has(parsedUrl.origin)) {
    return { allowed: true, url: sanitizeUrlForBrowserTrace(parsedUrl.href), reason: 'allowed_origin' };
  }

  throwBrowserUrlDenied({ url, reason, cause: 'external_origin_not_allowlisted' });
}

export function sanitizeUrlForBrowserTrace(url) {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.username = '';
    parsedUrl.password = '';
    parsedUrl.search = '';
    parsedUrl.hash = '';
    return parsedUrl.href;
  } catch {
    return INVALID_URL;
  }
}

export function sanitizeNetworkRecord(record = {}) {
  if (!record || typeof record !== 'object') return {};

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !BODY_FIELD_NAMES.has(key))
      .map(([key, value]) => {
        if (key === 'url') return [key, sanitizeUrlForBrowserTrace(value)];
        if (/headers$/i.test(key) || key === 'headers') return [key, sanitizeHeaders(value)];
        return [key, value];
      }),
  );
}

function throwBrowserUrlDenied({ url, reason, cause }) {
  const error = new Error(`Browser URL denied: ${cause}`);
  error.code = 'browser_url_denied';
  error.reason = reason;
  error.causeCode = cause;
  error.url = sanitizeUrlForBrowserTrace(url);
  throw error;
}
