import { evaluateMcpContentPoisoning } from './mcpPoisoningEval.js';

const TRUST_RANKS = {
  untrusted: 0,
  public: 1,
  community: 2,
  verified: 3,
  internal: 4,
};

function now() {
  return Date.now();
}

function normalizeList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return list.map((value) => String(value || '').trim()).filter(Boolean);
}

function normalizeTier(tier = 'public') {
  const normalized = String(tier || 'public').trim().toLowerCase();
  return Object.hasOwn(TRUST_RANKS, normalized) ? normalized : 'public';
}

function rank(tier) {
  return TRUST_RANKS[normalizeTier(tier)];
}

function matchesPattern(value, pattern) {
  if (pattern === value) return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return false;
}

function isListed(value, patterns) {
  if (!patterns.length) return true;
  return patterns.some((pattern) => matchesPattern(value, pattern));
}

function hasInlineCredential(value, parentKey = '') {
  if (/^(credentials?|credentialValues?|secrets?|token|api[_-]?key|password|passwd|authorization)$/i.test(parentKey)) {
    return true;
  }
  if (Array.isArray(value)) return value.some((item) => hasInlineCredential(item, parentKey));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, nestedValue]) => hasInlineCredential(nestedValue, key));
  }
  return false;
}

function emit(emitEvent, event) {
  if (typeof emitEvent === 'function') emitEvent(event);
}

function summarizeContent(content = []) {
  const list = Array.isArray(content) ? content : [content];
  return {
    itemCount: list.length,
    textBytes: list.reduce((sum, item) => sum + Buffer.byteLength(String(item?.text || ''), 'utf8'), 0),
  };
}

function publicPoisoningSummary(promptInjection) {
  return {
    flagged: Boolean(promptInjection?.flagged),
    categories: normalizeList(promptInjection?.categories),
  };
}

function policyMetadata(policy) {
  if (!policy) return undefined;
  return {
    policyId: policy.policyId,
    status: policy.status || 'shadow_only',
    mode: 'metadata_only',
  };
}

export function createMcpPolicy({
  allowedServers = [],
  allowedTools = [],
  riskyTools = [],
  trustTiers = {},
  minRiskyTrustTier = 'verified',
  rateLimits = {},
  credentialScopes = {},
  trustPolicy = null,
  emitEvent,
  clock = now,
} = {}) {
  const serverAllowlist = normalizeList(allowedServers);
  const toolAllowlist = normalizeList(allowedTools);
  const riskyToolList = normalizeList(riskyTools);
  const minRiskyRank = rank(minRiskyTrustTier);
  const rateBuckets = new Map();

  function getTrustTier(serverId) {
    return normalizeTier(trustTiers[serverId] || trustTiers.default || 'public');
  }

  function evaluateRateLimit({ serverId, tool }) {
    const limit = rateLimits[`${serverId}.${tool}`] || rateLimits[tool] || rateLimits[serverId] || rateLimits.default;
    if (!limit) return null;

    const maxCalls = Number(limit.maxCalls);
    const windowMs = Number(limit.windowMs);
    if (!Number.isFinite(maxCalls) || maxCalls <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) {
      return null;
    }

    const key = `${serverId}:${tool}`;
    const timestamp = clock();
    const bucket = (rateBuckets.get(key) || []).filter((entry) => timestamp - entry < windowMs);
    if (bucket.length >= maxCalls) {
      rateBuckets.set(key, bucket);
      return {
        status: 'blocked',
        allowed: false,
        reason: 'rate_limited',
        retryAfterMs: Math.max(0, windowMs - (timestamp - bucket[0])),
      };
    }
    bucket.push(timestamp);
    rateBuckets.set(key, bucket);
    return null;
  }

  function evaluateCredentials({ serverId, args = {} }) {
    if (hasInlineCredential(args)) {
      return {
        status: 'blocked',
        allowed: false,
        reason: 'inline_credentials_forbidden',
      };
    }

    const credentialNames = normalizeList(args.credentialNames);
    if (!credentialNames.length) return { credentialNames: [] };

    const scoped = new Set(normalizeList(credentialScopes[serverId] || credentialScopes.default));
    const unscoped = credentialNames.filter((name) => !scoped.has(name));
    if (unscoped.length) {
      return {
        status: 'blocked',
        allowed: false,
        reason: 'credential_not_scoped',
        credentialNames: credentialNames.filter((name) => scoped.has(name)),
      };
    }

    return { credentialNames };
  }

  function finalizeDecision(decision) {
    emit(emitEvent, {
      type: 'mcp.policy_evaluated',
      serverId: decision.serverId,
      tool: decision.tool,
      status: decision.status,
      reason: decision.reason,
      risk: decision.risk,
      trustTier: decision.trustTier,
    });
    if (decision.reason === 'rate_limited') {
      emit(emitEvent, {
        type: 'mcp.rate_limited',
        serverId: decision.serverId,
        tool: decision.tool,
        retryAfterMs: decision.retryAfterMs,
      });
    }
    if (trustPolicy) {
      decision.policy = policyMetadata(trustPolicy);
    }
    return decision;
  }

  function evaluateToolCall({ serverId = 'default', tool, args = {} } = {}) {
    const normalizedTool = String(tool || '').trim();
    const normalizedServerId = String(serverId || 'default').trim();
    const trustTier = getTrustTier(normalizedServerId);
    const base = { serverId: normalizedServerId, tool: normalizedTool, trustTier };

    if (!isListed(normalizedServerId, serverAllowlist)) {
      return finalizeDecision({
        ...base,
        status: 'blocked',
        allowed: false,
        reason: 'server_not_allowlisted',
      });
    }
    if (!isListed(normalizedTool, toolAllowlist)) {
      return finalizeDecision({
        ...base,
        status: 'blocked',
        allowed: false,
        reason: 'tool_not_allowlisted',
      });
    }

    const credentialDecision = evaluateCredentials({ serverId: normalizedServerId, args });
    if (credentialDecision.status === 'blocked') {
      return finalizeDecision({ ...base, ...credentialDecision });
    }

    const rateDecision = evaluateRateLimit({ serverId: normalizedServerId, tool: normalizedTool });
    if (rateDecision) {
      return finalizeDecision({ ...base, ...credentialDecision, ...rateDecision });
    }

    const risky = riskyToolList.some((pattern) => matchesPattern(normalizedTool, pattern));
    if (risky && rank(trustTier) < minRiskyRank) {
      return finalizeDecision({
        ...base,
        ...credentialDecision,
        status: 'blocked',
        allowed: false,
        reason: 'trust_tier_too_low',
        risk: 'high',
      });
    }
    if (risky) {
      return finalizeDecision({
        ...base,
        ...credentialDecision,
        status: 'approval_required',
        allowed: false,
        requiresApproval: true,
        reason: 'risky_tool_requires_approval',
        risk: 'high',
      });
    }

    return finalizeDecision({
      ...base,
      ...credentialDecision,
      status: 'allowed',
      allowed: true,
      risk: 'low',
    });
  }

  function evaluateToolResult({ serverId = 'default', tool, result = {} } = {}) {
    const promptInjection = evaluateMcpContentPoisoning({ content: result.content });
    const publicPromptInjection = publicPoisoningSummary(promptInjection);
    if (promptInjection.flagged) {
      emit(emitEvent, {
        type: 'mcp.poisoning_detected',
        serverId,
        tool,
        categories: promptInjection.categories,
      });
      return {
        ...result,
        status: 'blocked',
        allowed: false,
        isError: true,
        reason: 'mcp_poisoning_detected',
        content: [{
          type: 'text',
          text: 'MCP tool content was quarantined because prompt-injection patterns were detected.',
        }],
        quarantinedContent: summarizeContent(result.content),
        promptInjection: publicPromptInjection,
      };
    }
    return {
      ...result,
      promptInjection: publicPromptInjection,
    };
  }

  return {
    evaluateToolCall,
    evaluateToolResult,
  };
}

export const MCP_POLICY_CONSTANTS = {
  TRUST_RANKS,
};
