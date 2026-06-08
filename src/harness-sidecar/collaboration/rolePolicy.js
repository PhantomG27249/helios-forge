const ACTION_REQUIREMENTS = {
  merge_champion: 'owner',
  high_risk_action: 'owner',
  run_experiment: 'researcher',
  edit_workspace: 'researcher',
  memory_write: 'reviewer',
  final_report: 'reviewer',
};

const RISK_REQUIREMENTS = {
  high: 'owner',
  medium: 'researcher',
  low: 'researcher',
};

const ROLE_PERMISSIONS = {
  owner: new Set(['owner', 'researcher', 'reviewer']),
  researcher: new Set(['researcher', 'reviewer']),
  reviewer: new Set(['reviewer']),
  observer: new Set([]),
};

function requiredRoleFor({ action, risk }) {
  return ACTION_REQUIREMENTS[action] || RISK_REQUIREMENTS[risk] || 'researcher';
}

function denialReason({ role, requiredRole }) {
  if (role === 'observer') return 'observer_read_only';
  if (requiredRole === 'owner') return 'requires_owner';
  if (requiredRole === 'researcher') return 'requires_researcher';
  if (requiredRole === 'reviewer') return 'requires_reviewer';
  return 'role_not_permitted';
}

export function decideRoleApproval({ role, action, risk = 'medium' } = {}) {
  const requiredRole = requiredRoleFor({ action, risk });
  const permissions = ROLE_PERMISSIONS[role];

  if (!permissions) {
    return {
      allowed: false,
      reason: 'unknown_role',
      requiredRole,
    };
  }

  if (permissions.has(requiredRole)) {
    return {
      allowed: true,
      reason: 'role_permits_action',
      requiredRole,
    };
  }

  return {
    allowed: false,
    reason: denialReason({ role, requiredRole }),
    requiredRole,
  };
}

