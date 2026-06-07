export function createPermissionPolicy({
  mode = 'safe_edit',
  allowedTools = [],
  riskyTools = [],
} = {}) {
  const allowed = new Set(allowedTools);
  const risky = new Set(riskyTools);

  return {
    mode,
    evaluateToolCall({ tool }) {
      if (risky.has(tool)) {
        return { allowed: false, requiresApproval: true, risk: 'high' };
      }
      if (allowed.has(tool)) {
        return { allowed: true, requiresApproval: false, risk: 'low' };
      }
      return { allowed: false, requiresApproval: false, risk: 'blocked' };
    },
  };
}
