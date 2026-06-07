const REDACTED = '[redacted]';
const SUPPORTED_PROTOCOLS = ['a2a', 'acp', 'http', 'local'];
const TRUST_RANKS = {
  untrusted: 0,
  public: 1,
  community: 2,
  verified: 3,
  internal: 4,
};

function normalizeStringList(values = []) {
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

function normalizeNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function isSecretLikeKey(key) {
  return /authorization|token|secret|password|passwd|api[_-]?key|credential|private/i.test(key);
}

function isSecretLikeValue(value) {
  return typeof value === 'string' && /^(sk-|gh[pousr]_|xox[baprs]-|bearer\s+)/i.test(value.trim());
}

export function redactSecrets(value, parentKey = '') {
  if (isSecretLikeKey(parentKey) || isSecretLikeValue(value)) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        redactSecrets(nestedValue, key),
      ]),
    );
  }

  return value;
}

export function getTrustRank(trustLevel = 'public') {
  const normalized = String(trustLevel || 'public').trim().toLowerCase();
  return TRUST_RANKS[normalized] ?? TRUST_RANKS.public;
}

function normalizeProtocol(protocol) {
  const normalized = String(protocol || '').trim().toLowerCase();
  if (!SUPPORTED_PROTOCOLS.includes(normalized)) {
    throw new Error(`Unsupported agent protocol: ${protocol || '(empty)'}`);
  }
  return normalized;
}

function normalizeId(id) {
  const normalized = String(id || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9._:-]{1,127}$/.test(normalized)) {
    throw new Error(`Invalid agent id: ${id || '(empty)'}`);
  }
  return normalized;
}

function normalizeEndpoint({ protocol, endpoint }) {
  if (protocol === 'local') return endpoint ? redactSecrets(endpoint) : null;
  if (!endpoint || typeof endpoint !== 'object' || !String(endpoint.url || '').trim()) {
    throw new Error(`Agent protocol ${protocol} requires endpoint.url`);
  }

  return redactSecrets({
    ...endpoint,
    url: String(endpoint.url).trim(),
  });
}

function normalizeCommand({ protocol, command }) {
  if (protocol !== 'local') return command ? redactSecrets(command) : null;
  if (!command) throw new Error('Local agent protocol requires command metadata');

  if (typeof command === 'string') {
    return { executable: command, args: [] };
  }

  if (!command.executable) throw new Error('Local agent command.executable is required');
  return redactSecrets({
    ...command,
    executable: String(command.executable).trim(),
    args: normalizeStringList(command.args),
  });
}

function normalizeCostModel(costModel = {}) {
  return {
    currency: String(costModel.currency || 'USD').trim().toUpperCase(),
    baseCost: normalizeNumber(costModel.baseCost),
    perRequestCost: normalizeNumber(costModel.perRequestCost),
    perTokenCost: normalizeNumber(costModel.perTokenCost),
    perInputTokenCost: normalizeNumber(costModel.perInputTokenCost),
    perOutputTokenCost: normalizeNumber(costModel.perOutputTokenCost),
  };
}

function normalizeLatencyStats(latencyStats = {}) {
  return {
    p50Ms: normalizeNumber(latencyStats.p50Ms),
    p95Ms: normalizeNumber(latencyStats.p95Ms),
    averageMs: normalizeNumber(latencyStats.averageMs),
  };
}

function normalizeToolPermissions(toolPermissions = {}) {
  return {
    allowed: normalizeStringList(toolPermissions.allowed),
    denied: normalizeStringList(toolPermissions.denied),
    scopes: normalizeStringList(toolPermissions.scopes),
    env: redactSecrets(toolPermissions.env || {}),
  };
}

export function normalizeAgentCard(card = {}) {
  if (!card || typeof card !== 'object') throw new Error('agent card is required');

  const id = normalizeId(card.id);
  const protocol = normalizeProtocol(card.protocol);
  const name = String(card.name || '').trim();
  if (!name) throw new Error('agent name is required');

  const trustLevel = String(card.trustLevel || 'public').trim().toLowerCase();

  return {
    id,
    name,
    protocol,
    endpoint: normalizeEndpoint({ protocol, endpoint: card.endpoint }),
    command: normalizeCommand({ protocol, command: card.command }),
    capabilities: normalizeStringList(card.capabilities),
    costModel: normalizeCostModel(card.costModel),
    latencyStats: normalizeLatencyStats(card.latencyStats),
    trustLevel,
    trustRank: getTrustRank(trustLevel),
    toolPermissions: normalizeToolPermissions(card.toolPermissions),
    available: card.available !== false,
    metadata: redactSecrets(card.metadata || {}),
  };
}

export function normalizeAgentCards(cards = []) {
  if (!Array.isArray(cards)) throw new Error('agent cards must be an array');
  return cards.map((card) => normalizeAgentCard(card));
}

export const AGENT_CARD_CONSTANTS = {
  REDACTED,
  SUPPORTED_PROTOCOLS,
  TRUST_RANKS,
};
