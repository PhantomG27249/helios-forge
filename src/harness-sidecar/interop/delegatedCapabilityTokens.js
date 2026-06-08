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
    mode: String(token.mode || 'read'),
    issuedBy: String(token.issuedBy || ''),
    issuedAt: Number(token.issuedAt || 0),
    expiresAt: Number(token.expiresAt || 0),
  });
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
  mode = 'read',
  issuedBy,
  ttlMs = 5 * 60 * 1000,
  now = Date.now(),
  issuerSecret,
} = {}) {
  const issuedAt = Number(now);
  const ttl = Number(ttlMs);
  const token = {
    tokenId: makeTokenId({ now: () => issuedAt }),
    taskId: String(taskId || ''),
    agentId: String(agentId || ''),
    capabilities: normalizeList(capabilities),
    mode: String(mode || 'read'),
    issuedBy: String(issuedBy || ''),
    issuedAt,
    expiresAt: issuedAt + (Number.isFinite(ttl) && ttl > 0 ? ttl : 0),
  };
  return {
    ...token,
    signature: signTokenPayload(token, issuerSecret),
  };
}

export function verifyDelegatedCapabilityToken(token, {
  taskId,
  agentId,
  capability,
  mode = 'read',
  now = Date.now(),
  issuerSecret,
} = {}) {
  const reasons = [];
  if (!token) {
    return { valid: false, reasons: ['missing_token'] };
  }

  const timestamp = Number(now);
  const expectedSignature = signTokenPayload(token, issuerSecret);
  if (!signaturesMatch(token.signature, expectedSignature)) reasons.push('invalid_signature');
  if (String(token.taskId || '') !== String(taskId || '')) reasons.push('task_mismatch');
  if (String(token.agentId || '') !== String(agentId || '')) reasons.push('agent_mismatch');
  if (String(token.mode || '') !== String(mode || 'read')) reasons.push('mode_mismatch');
  if (!normalizeList(token.capabilities).includes(String(capability || ''))) {
    reasons.push('capability_not_delegated');
  }
  if (Number(token.expiresAt) <= timestamp) reasons.push('expired');

  return {
    valid: reasons.length === 0,
    reasons,
  };
}
