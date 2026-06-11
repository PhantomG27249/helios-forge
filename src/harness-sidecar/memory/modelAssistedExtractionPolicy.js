const REQUIRED_MODEL_ASSISTED_GUARDS = [
  'schema_validation',
  'retrieved_provenance_required',
  'model_visible_quarantine',
  'evidence_only_authority',
  'no_direct_memory_promotion',
];

function gateFromConfig(config = {}) {
  return config.productionCapabilities?.modelAssistedMemory
    || config.modelAssistedMemory
    || {};
}

function hasPositiveBudget(budget = {}) {
  const values = [
    budget.modelAssistedMemory,
    budget.modelAssistedMemoryRemaining,
    budget.tokensRemaining,
    budget.tokenBudget,
  ].filter((value) => value !== undefined);
  return values.length === 0 || values.some((value) => Number(value) > 0);
}

function riskLevel(risk = {}) {
  if (typeof risk === 'string') return risk;
  return risk.level || risk.classification || risk.severity || 'normal';
}

export function chooseMemoryExtractionMode({
  config,
  caseContext = {},
  budget = {},
  risk = {},
} = {}) {
  const gate = gateFromConfig(config);
  const reasons = [];

  if (gate.enabled !== true) reasons.push('model_assisted_memory_disabled');
  if (!gate.mode || gate.mode === 'offline') reasons.push('model_assisted_memory_offline');
  if (gate.authority && gate.authority !== 'evidence_only') reasons.push('model_assisted_memory_authority_not_evidence_only');
  if (!hasPositiveBudget(budget)) reasons.push('model_assisted_memory_budget_exhausted');
  if (['high', 'critical'].includes(riskLevel(risk))) reasons.push('model_assisted_memory_risk_too_high');

  const mode = reasons.length === 0 ? 'model_assisted' : 'deterministic';
  const requiredGuards = mode === 'model_assisted'
    ? REQUIRED_MODEL_ASSISTED_GUARDS
    : [];

  return {
    mode,
    reasons: reasons.sort(),
    requiredGuards,
  };
}
