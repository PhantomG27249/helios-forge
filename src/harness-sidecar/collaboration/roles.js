const ROLE_POLICIES = {
  orchestrator: {
    role: 'orchestrator',
    canApprove: false,
    allowedActions: ['claim', 'assign', 'plan', 'propose_patch', 'request_approval'],
  },
  implementer: {
    role: 'implementer',
    canApprove: false,
    allowedActions: ['claim', 'edit', 'run_verifier', 'propose_patch', 'comment'],
  },
  reviewer: {
    role: 'reviewer',
    canApprove: true,
    allowedActions: ['claim', 'review', 'approve', 'reject', 'comment'],
  },
  observer: {
    role: 'observer',
    canApprove: false,
    allowedActions: ['comment'],
  },
};

export function getRolePolicy(role) {
  const policy = ROLE_POLICIES[role];
  if (!policy) {
    throw new Error(`Unknown collaboration role: ${role}`);
  }
  return {
    ...policy,
    allowedActions: [...policy.allowedActions],
  };
}
