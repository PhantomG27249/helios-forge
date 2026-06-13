import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_ISSUER_SECRET = randomBytes(32).toString('hex');

function makeTokenId({ now = Date.now } = {}) {
  return `dct_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return list.map((value) => String(value || '').trim()).filter(Boolean);
}

function canonicalTokenPayload(token) {
  return JSON.stringify({
    tokenId: String(token.tokenId || ''),
    taskId: String(token.taskId || ''),
    agentId: String(token.agentId || ''),
    capabilities: normalizeList(token.capabilities).sort(),
    scopes: normalizeList(token.scopes).sort(),
    mode: String(token.mode || 'read'),
    issuedBy: String(token.issuedBy || ''),
    issuerKeyRef: String(token.issuerKeyRef || ''),
    issuedAt: Number(token.issuedAt || 0),
    expiresAt: Number(token.expiresAt || 0),
  });
}

function resolveIssuerSecret({
  issuerSecret,
  issuerSecretProvider,
  issuerKeyRef,
  issuedBy,
  agentId,
} = {}) {
  if (issuerSecret !== undefined && issuerSecret !== null) return issuerSecret;
  const lookup = {
    keyRef: issuerKeyRef,
    issuerId: issuedBy || agentId,
  };
  if (issuerSecretProvider && typeof issuerSecretProvider.getIssuerSecret === 'function') {
    return issuerSecretProvider.getIssuerSecret(lookup);
  }
  if (issuerSecretProvider && typeof issuerSecretProvider.loadIssuerSecret === 'function') {
    return issuerSecretProvider.loadIssuerSecret(lookup);
  }
  if (typeof issuerSecretProvider === 'function') return issuerSecretProvider(lookup);
  return undefined;
}

function signTokenPayload(token, issuerSecret) {
  return createHmac('sha256', String(issuerSecret || DEFAULT_ISSUER_SECRET))
    .update(canonicalTokenPayload(token))
    .digest('hex');
}

function signaturesMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length > 0
    && leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createDelegatedCapabilityToken({
  taskId,
  agentId,
  capabilities = [],
  scopes = [],
  mode = 'read',
  issuedBy,
  issuerKeyRef,
  ttlMs = 5 * 60 * 1000,
  now = Date.now(),
  issuerSecret,
  issuerSecretProvider,
} = {}) {
  const issuedAt = Number(now);
  const ttl = Number(ttlMs);
  const token = {
    tokenId: makeTokenId({ now: () => issuedAt }),
    taskId: String(taskId || ''),
    agentId: String(agentId || ''),
    capabilities: normalizeList(capabilities),
    scopes: normalizeList(scopes),
    mode: String(mode || 'read'),
    issuedBy: String(issuedBy || ''),
    issuerKeyRef: String(issuerKeyRef || ''),
    issuedAt,
    expiresAt: issuedAt + (Number.isFinite(ttl) && ttl > 0 ? ttl : 0),
  };
  const resolvedIssuerSecret = resolveIssuerSecret({
    issuerSecret,
    issuerSecretProvider,
    issuerKeyRef: token.issuerKeyRef,
    issuedBy: token.issuedBy,
    agentId: token.agentId,
  });
  return {
    ...token,
    signature: signTokenPayload(token, resolvedIssuerSecret),
  };
}

export function verifyDelegatedCapabilityToken(token, {
  taskId,
  agentId,
  capability,
  scope,
  mode = 'read',
  now = Date.now(),
  issuerSecret,
  issuerSecretProvider,
  issuerKeyRef,
} = {}) {
  const reasons = [];
  if (!token) {
    return { valid: false, reasons: ['missing_token'] };
  }

  const timestamp = Number(now);
  const expectedSignature = signTokenPayload(token, resolveIssuerSecret({
    issuerSecret,
    issuerSecretProvider,
    issuerKeyRef: issuerKeyRef || token.issuerKeyRef,
    issuedBy: token.issuedBy,
    agentId: token.agentId,
  }));
  if (!signaturesMatch(token.signature, expectedSignature)) reasons.push('invalid_signature');
  if (String(token.taskId || '') !== String(taskId || '')) reasons.push('task_mismatch');
  if (String(token.agentId || '') !== String(agentId || '')) reasons.push('agent_mismatch');
  if (String(token.mode || '') !== String(mode || 'read')) reasons.push('mode_mismatch');
  if (!normalizeList(token.capabilities).includes(String(capability || ''))) {
    reasons.push('capability_not_delegated');
  }
  if (scope !== undefined && !normalizeList(token.scopes).includes(String(scope || ''))) {
    reasons.push('scope_not_delegated');
  }
  if (Number(token.expiresAt) <= timestamp) reasons.push('expired');

  return {
    valid: reasons.length === 0,
    reasons,
  };
}
