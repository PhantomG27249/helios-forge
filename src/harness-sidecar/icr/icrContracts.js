export const ICR_DEFAULT_CONFIG = Object.freeze({
  lane: 'icr',
  branchBreadth: 5,
  correctionDepth: 10,
  hypothesisCount: 6,
  hypothesisRefreshInterval: 2,
  pqfInterval: 4,
  distillationInterval: 5,
  solutionPoolSize: 8,
  maxComputeMultiplier: 40,
  maxContextTokens: 140000,
  evidenceOnly: true,
  promotionAllowed: false,
});

export const ICR_AGENT_ROLES = Object.freeze({
  strategy: 'strategy',
  hypothesis: 'hypothesis',
  executor: 'executor',
  critique: 'critique',
  correction: 'correction',
  pqf: 'pqf',
  distiller: 'distiller',
  finalJudge: 'final_judge',
});

export const ICR_ARTIFACT_TYPES = Object.freeze({
  branchTrace: 'branch_trace',
  hypothesisPacket: 'hypothesis_packet',
  solutionPool: 'solution_pool',
  pqfRecord: 'pqf_record',
  blindJudgment: 'blind_judgment',
  branchMemory: 'branch_memory',
  critiqueRecord: 'critique_record',
  correctionRecord: 'correction_record',
  distillationRecord: 'distillation_record',
  finalJudgePacket: 'blind_final_judge_packet',
});

const POSITIVE_INTEGER_FIELDS = Object.freeze([
  'branchBreadth',
  'hypothesisCount',
  'hypothesisRefreshInterval',
  'pqfInterval',
  'distillationInterval',
  'solutionPoolSize',
  'maxComputeMultiplier',
  'maxContextTokens',
]);

const ROLE_CONTEXT_POLICIES = Object.freeze({
  [ICR_AGENT_ROLES.strategy]: Object.freeze({
    role: ICR_AGENT_ROLES.strategy,
    allowedContext: Object.freeze(['task_rubric', 'prior_strategy_summary', 'cost_limits']),
    excludedContext: Object.freeze(['promotion_authority']),
    blindJudge: false,
  }),
  [ICR_AGENT_ROLES.hypothesis]: Object.freeze({
    role: ICR_AGENT_ROLES.hypothesis,
    allowedContext: Object.freeze(['task_rubric', 'strategy', 'branch_summary', 'active_hypotheses']),
    excludedContext: Object.freeze(['promotion_authority']),
    blindJudge: false,
  }),
  [ICR_AGENT_ROLES.executor]: Object.freeze({
    role: ICR_AGENT_ROLES.executor,
    allowedContext: Object.freeze(['task_rubric', 'strategy', 'active_hypotheses', 'branch_memory']),
    excludedContext: Object.freeze(['promotion_authority']),
    blindJudge: false,
  }),
  [ICR_AGENT_ROLES.critique]: Object.freeze({
    role: ICR_AGENT_ROLES.critique,
    allowedContext: Object.freeze(['task_rubric', 'candidate_solution', 'active_hypotheses', 'visible_metrics']),
    excludedContext: Object.freeze(['promotion_authority']),
    blindJudge: false,
  }),
  [ICR_AGENT_ROLES.correction]: Object.freeze({
    role: ICR_AGENT_ROLES.correction,
    allowedContext: Object.freeze(['task_rubric', 'candidate_solution', 'critique_records', 'branch_memory']),
    excludedContext: Object.freeze(['promotion_authority']),
    blindJudge: false,
  }),
  [ICR_AGENT_ROLES.pqf]: Object.freeze({
    role: ICR_AGENT_ROLES.pqf,
    allowedContext: Object.freeze(['branch_summaries', 'visible_metrics', 'pqf_history']),
    excludedContext: Object.freeze(['promotion_authority']),
    blindJudge: false,
  }),
  [ICR_AGENT_ROLES.distiller]: Object.freeze({
    role: ICR_AGENT_ROLES.distiller,
    allowedContext: Object.freeze(['branch_memory', 'critique_records', 'correction_records', 'pqf_records']),
    excludedContext: Object.freeze(['promotion_authority']),
    blindJudge: false,
  }),
  [ICR_AGENT_ROLES.finalJudge]: Object.freeze({
    role: ICR_AGENT_ROLES.finalJudge,
    allowedContext: Object.freeze([
      'candidate_solutions',
      'candidate_ids',
      'visible_metrics',
      'task_rubric',
    ]),
    excludedContext: Object.freeze([
      'branch_memory',
      'critique_records',
      'pqf_records',
      'replaced_branches',
      'hypothesis_history',
    ]),
    blindJudge: true,
  }),
});

function normalizePositiveInteger(config, field) {
  const value = Number(config[field]);
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`ICR ${field} must be >= 1`);
  }
  return value;
}

function normalizeCorrectionDepth(config) {
  const value = Number(config.correctionDepth);
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('ICR correctionDepth must be >= 1');
  }
  return value;
}

function normalizeContextTokens(config) {
  const value = Number(config.maxContextTokens);
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('ICR maxContextTokens must be finite and bounded');
  }
  return value;
}

export function normalizeIcrConfig(input = {}) {
  const source = input && typeof input === 'object' ? input : {};

  if (source.evidenceOnly === false) {
    throw new Error('ICR evidenceOnly must remain true');
  }
  if (source.promotionAllowed === true || source.canPromote === true || source.promotion?.allowed === true) {
    throw new Error('ICR promotion authority is not allowed');
  }

  const config = {
    ...ICR_DEFAULT_CONFIG,
    ...source,
    lane: ICR_DEFAULT_CONFIG.lane,
    evidenceOnly: true,
    promotionAllowed: false,
  };

  config.correctionDepth = normalizeCorrectionDepth(config);
  for (const field of POSITIVE_INTEGER_FIELDS) {
    if (field === 'maxContextTokens') {
      config[field] = normalizeContextTokens(config);
    } else {
      config[field] = normalizePositiveInteger(config, field);
    }
  }

  return Object.freeze(config);
}

export function getIcrRoleContextPolicy(role) {
  const key = String(role ?? '').trim().toLowerCase();
  const policy = ROLE_CONTEXT_POLICIES[key];
  if (!policy) {
    throw new Error(`Unknown ICR agent role: ${role}`);
  }
  return {
    ...policy,
    allowedContext: [...policy.allowedContext],
    excludedContext: [...policy.excludedContext],
  };
}

export function assertIcrEvidenceOnly(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('ICR record must be an object');
  }
  if (record.evidenceOnly !== true) {
    throw new Error('ICR record must be evidence-only');
  }
  if (record.promotionAllowed === true || record.canPromote === true || record.promotion?.allowed === true) {
    throw new Error('ICR record cannot allow promotion');
  }
  if (record.authority !== undefined && record.authority !== 'evidence_only') {
    throw new Error('ICR record authority must be evidence_only');
  }
  return record;
}
