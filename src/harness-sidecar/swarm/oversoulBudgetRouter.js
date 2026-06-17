function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function roleMatches(role, candidates = []) {
  const normalizedRole = normalizeRole(role);
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeRole(candidate);
    return normalizedRole === normalizedCandidate
      || normalizedRole.includes(normalizedCandidate)
      || normalizedCandidate.includes(normalizedRole);
  });
}

function cellPriority(cell = {}, roleEcology = {}) {
  const coreRoles = roleEcology.coreRoles || [];
  const missingRoles = roleEcology.missingRoles || [];
  const role = cell.role || cell.cellId || 'implementer';

  if (roleMatches(role, missingRoles)) return 0.85;
  if (roleMatches(role, coreRoles)) return 0.55;
  return 0.35;
}

function rationaleForCell({ cell, priority, roleEcology = {} }) {
  const role = cell.role || cell.cellId || 'implementer';
  const parts = ['advisory oversoul budget split'];

  if (roleMatches(role, roleEcology.missingRoles)) {
    parts.push(`boosted for missing role coverage (${role})`);
  } else if (roleMatches(role, roleEcology.coreRoles)) {
    parts.push(`baseline for core role (${role})`);
  } else {
    parts.push(`baseline for auxiliary role (${role})`);
  }

  parts.push(`priority ${priority.toFixed(2)}`);
  return parts.join('; ');
}

function distributeIntegerTotal(weights, total) {
  if (weights.length === 0) return [];
  const normalizedTotal = Math.max(0, Math.floor(numeric(total, 0)));
  if (normalizedTotal === 0) return weights.map(() => 0);

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0) || weights.length;
  const raw = weights.map((weight) => (normalizedTotal * weight) / weightSum);
  const floors = raw.map((value) => Math.floor(value));
  let remainder = normalizedTotal - floors.reduce((sum, value) => sum + value, 0);

  const ranked = raw
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((left, right) => right.fraction - left.fraction);

  const allocated = [...floors];
  for (const entry of ranked) {
    if (remainder <= 0) break;
    allocated[entry.index] += 1;
    remainder -= 1;
  }

  return allocated;
}

export function allocateOversoulBudget({
  cells = [],
  totalBudget = {},
  roleEcology = {},
} = {}) {
  const maxOutputChars = Math.max(0, Math.floor(numeric(totalBudget.maxOutputChars, 0)));
  const maxToolCalls = Math.max(0, Math.floor(numeric(totalBudget.maxToolCalls, 0)));
  const priorities = cells.map((cell) => clamp(cellPriority(cell, roleEcology), 0.1, 1));
  const outputAllocations = distributeIntegerTotal(priorities, maxOutputChars);
  const toolAllocations = distributeIntegerTotal(priorities, maxToolCalls);

  const allocatedCells = cells.map((cell, index) => {
    const priority = priorities[index];
    const budget = {
      ...(cell.budget || {}),
      maxOutputChars: outputAllocations[index],
      maxToolCalls: toolAllocations[index],
      priority,
      durableApplyApproved: false,
    };
    const budgetRationale = {
      maxOutputChars: budget.maxOutputChars,
      maxToolCalls: budget.maxToolCalls,
      priority,
      rationale: rationaleForCell({ cell, priority, roleEcology }),
    };

    return {
      ...cell,
      budget,
      budgetRationale,
    };
  });

  return {
    cells: allocatedCells,
    roleEcology,
    authority: 'advisory',
    evidenceOnly: true,
    canPromote: false,
  };
}
