function makeTokenId() {
  return `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createCapabilityToken({
  taskId,
  tool,
  action,
  ttlMs = 5 * 60 * 1000,
}) {
  return {
    tokenId: makeTokenId(),
    taskId,
    tool,
    action,
    issuedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  };
}

export function verifyCapabilityToken(token, expected) {
  const reasons = [];
  if (!token) reasons.push('missing_token');
  if (token && token.expiresAt <= Date.now()) reasons.push('expired');
  if (token && expected.taskId !== token.taskId) reasons.push('task_mismatch');
  if (token && expected.tool !== token.tool) reasons.push('tool_mismatch');
  if (token && expected.action !== token.action) reasons.push('action_mismatch');

  return {
    valid: reasons.length === 0,
    reasons,
  };
}
