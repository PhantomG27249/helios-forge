import {
  getTrustRank,
  normalizeAgentCard,
  normalizeAgentCards,
  redactSecrets,
} from './agentCards.js';

function normalizeCapabilityList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return list.map((value) => String(value || '').trim()).filter(Boolean);
}

function estimateCost({ agent, task = {} }) {
  const costModel = agent.costModel || {};
  const estimatedTokens = Number(task.estimatedTokens || 0);
  const inputTokens = Number(task.estimatedInputTokens || estimatedTokens || 0);
  const outputTokens = Number(task.estimatedOutputTokens || 0);

  if (![estimatedTokens, inputTokens, outputTokens].every(Number.isFinite)) {
    return Infinity;
  }

  return (
    Number(costModel.baseCost || 0)
    + Number(costModel.perRequestCost || 0)
    + Number(costModel.perTokenCost || 0) * estimatedTokens
    + Number(costModel.perInputTokenCost || 0) * inputTokens
    + Number(costModel.perOutputTokenCost || 0) * outputTokens
  );
}

function estimateLatency(agent) {
  const latencyStats = agent.latencyStats || {};
  return Number(
    latencyStats.p95Ms
    || latencyStats.averageMs
    || latencyStats.p50Ms
    || 0,
  );
}

function hasRequiredCapabilities(agent, requiredCapabilities) {
  const available = new Set(agent.capabilities || []);
  return requiredCapabilities.every((capability) => available.has(capability));
}

function evaluateAgent({ agent, task, constraints = {}, policy }) {
  const requiredCapabilities = normalizeCapabilityList(task.requiredCapabilities);
  const estimatedCost = estimateCost({ agent, task });
  const estimatedLatencyMs = estimateLatency(agent);
  const minTrustLevel = constraints.minTrustLevel || 'public';
  const minTrustRank = getTrustRank(minTrustLevel);

  if (agent.available === false) {
    return { allowed: false, reason: 'unavailable', estimatedCost, estimatedLatencyMs };
  }
  if (!hasRequiredCapabilities(agent, requiredCapabilities)) {
    return { allowed: false, reason: 'missing_capability', estimatedCost, estimatedLatencyMs };
  }
  if (agent.trustRank < minTrustRank) {
    return { allowed: false, reason: 'trust_below_threshold', estimatedCost, estimatedLatencyMs };
  }
  if (constraints.maxCost !== undefined && estimatedCost > Number(constraints.maxCost)) {
    return { allowed: false, reason: 'cost_above_limit', estimatedCost, estimatedLatencyMs };
  }
  if (constraints.maxLatencyMs !== undefined && estimatedLatencyMs > Number(constraints.maxLatencyMs)) {
    return { allowed: false, reason: 'latency_above_limit', estimatedCost, estimatedLatencyMs };
  }

  if (typeof policy === 'function') {
    const policyDecision = policy({ agent, task, constraints, estimatedCost, estimatedLatencyMs });
    if (policyDecision === false || policyDecision?.allowed === false) {
      return {
        allowed: false,
        reason: policyDecision?.reason || 'policy_denied',
        estimatedCost,
        estimatedLatencyMs,
      };
    }
  }

  return { allowed: true, reason: 'eligible', estimatedCost, estimatedLatencyMs };
}

export function chooseAgentRoute({
  task = {},
  agents = [],
  constraints = {},
  policy,
} = {}) {
  const normalizedAgents = normalizeAgentCards(agents);
  const candidates = [];
  const rejections = [];

  for (const agent of normalizedAgents) {
    const evaluation = evaluateAgent({ agent, task, constraints, policy });
    if (evaluation.allowed) {
      candidates.push({
        agent,
        estimatedCost: evaluation.estimatedCost,
        estimatedLatencyMs: evaluation.estimatedLatencyMs,
      });
    } else {
      rejections.push({
        agentId: agent.id,
        reason: evaluation.reason,
        estimatedCost: evaluation.estimatedCost,
        estimatedLatencyMs: evaluation.estimatedLatencyMs,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      status: 'no_route',
      agent: null,
      reason: 'no_agent_satisfies_constraints',
      estimatedCost: null,
      estimatedLatencyMs: null,
      rejections,
    };
  }

  candidates.sort((left, right) => (
    left.estimatedCost - right.estimatedCost
    || left.estimatedLatencyMs - right.estimatedLatencyMs
    || right.agent.trustRank - left.agent.trustRank
    || left.agent.id.localeCompare(right.agent.id)
  ));

  const selected = candidates[0];
  return {
    status: 'selected',
    agent: selected.agent,
    reason: 'selected_best_fit',
    estimatedCost: selected.estimatedCost,
    estimatedLatencyMs: selected.estimatedLatencyMs,
    rejections,
  };
}

function cloneEndpointForDispatch(agent) {
  if (!agent.endpoint) return null;
  const endpoint = redactSecrets(agent.endpoint);
  const { headers, auth, apiKey, token, secret, credentials, ...safeEndpoint } = endpoint;
  void headers;
  void auth;
  void apiKey;
  void token;
  void secret;
  void credentials;
  return safeEndpoint;
}

function cloneCommandForDispatch(agent) {
  if (!agent.command) return null;
  const command = redactSecrets(agent.command);
  const { env, ...safeCommand } = command;
  void env;
  return safeCommand;
}

function isCredentialKey(key) {
  return /authorization|token|secret|password|passwd|api[_-]?key|credential|private/i.test(key);
}

function stripCredentialFields(value, parentKey = '') {
  if (isCredentialKey(parentKey)) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => stripCredentialFields(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, nestedValue]) => [key, stripCredentialFields(nestedValue, key)])
        .filter(([, nestedValue]) => nestedValue !== undefined),
    );
  }
  return redactSecrets(value);
}

function scrubPrompt(prompt) {
  return String(prompt || '')
    .replace(/(sk-[A-Za-z0-9_-]+)/g, '[redacted]')
    .replace(/(gh[pousr]_[A-Za-z0-9_-]+)/gi, '[redacted]')
    .replace(/(xox[baprs]-[A-Za-z0-9_-]+)/gi, '[redacted]')
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password|passwd|credential)\s*=\s*)\S+/gi, '$1[redacted]');
}

function scopeContextByCapabilities(context = {}, capabilities = []) {
  const scoped = {};
  for (const capability of capabilities) {
    if (Object.hasOwn(context, capability)) {
      scoped[capability] = stripCredentialFields(context[capability]);
    }
  }
  return scoped;
}

export function buildGatewayRequest({
  agent,
  task = {},
  grantedCapabilities,
} = {}) {
  const normalizedAgent = normalizeAgentCard(agent);
  const requested = normalizeCapabilityList(task.requiredCapabilities);
  const grants = normalizeCapabilityList(grantedCapabilities || requested)
    .filter((capability) => normalizedAgent.capabilities.includes(capability));
  const missingCapabilities = requested.filter((capability) => !grants.includes(capability));
  if (missingCapabilities.length) {
    throw new Error(`Gateway request missing required capabilities: ${missingCapabilities.join(', ')}`);
  }

  return {
    version: 1,
    protocol: normalizedAgent.protocol,
    agent: {
      id: normalizedAgent.id,
      name: normalizedAgent.name,
      protocol: normalizedAgent.protocol,
      endpoint: cloneEndpointForDispatch(normalizedAgent),
      command: cloneCommandForDispatch(normalizedAgent),
      toolPermissions: {
        allowed: [...normalizedAgent.toolPermissions.allowed],
        denied: [...normalizedAgent.toolPermissions.denied],
        scopes: [...normalizedAgent.toolPermissions.scopes],
      },
    },
    capabilities: grants,
    task: {
      id: String(task.id || ''),
      prompt: scrubPrompt(task.prompt),
      context: scopeContextByCapabilities(task.context || {}, grants),
      requiredCapabilities: requested.filter((capability) => grants.includes(capability)),
    },
  };
}

export const AGENT_ROUTER_CONSTANTS = {
  estimateCost,
  estimateLatency,
};
