const REDACTED = '[redacted]';

const ICR_DEFAULT_CONFIG = Object.freeze({
  maxComputeMultiplier: 40,
  maxContextTokens: 140000,
  evidenceOnly: true,
  promotionAllowed: false,
});

const HIDDEN_DASHBOARD_KEYS = new Set([
  'branchMemory',
  'branch_memory',
  'critiqueRecords',
  'critique_records',
  'pqfRecords',
  'pqf_records',
  'replacedBranches',
  'replaced_branches',
  'hypothesisHistory',
  'hypothesis_history',
  'activeHypotheses',
  'hypotheses',
  'candidateText',
  'critiqueSummary',
  'correctionSummary',
  'rawPrompt',
  'rawOutput',
  'messages',
]);

const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|cookie|client[_-]?secret|refresh[_-]?token)/i;
const SECRET_TEXT_PATTERNS = [
  /\b(?:api[_-]?key|token|secret|password|client[_-]?secret)\s*[:=]\s*['"]?[^'"\s,;}]+/gi,
  /\bauthorization\s*:\s*bearer\s+[^'"\s,;}]+/gi,
  /\bbearer\s+[a-z0-9._~+/=-]{8,}/gi,
  /\bsk-[a-z0-9_-]{6,}/gi,
  /\bgh[pousr]_[a-z0-9_]{6,}/gi,
];
const LOCAL_PATH_PATTERNS = [
  /\b[a-z]:[\\/](?:[^\\/\s"'<>|:]+[\\/])*[^\\/\s"'<>|:]*/gi,
  /(?<![\w/])\/(?:Users|home|tmp|var|private|mnt)\/[^\s"'<>]+/g,
];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMetric(value) {
  return Number(finiteNumber(value).toFixed(6));
}

function normalizeConfig(record = {}, config = {}) {
  return {
    ...ICR_DEFAULT_CONFIG,
    ...asObject(record.config),
    ...asObject(config),
  };
}

function branchRecords(record = {}) {
  return asArray(record.branches ?? record.branchTraces ?? record.traces)
    .filter((branch) => branch && typeof branch === 'object');
}

function solutionPoolItems(record = {}) {
  const pool = record.solutionPool ?? record.solution_pool ?? record.solutions;
  if (Array.isArray(pool)) return pool;
  if (pool && typeof pool === 'object') {
    return asArray(pool.candidates ?? pool.items ?? pool.solutions ?? pool.variants);
  }
  return asArray(record.solutionPoolCandidates ?? record.candidates);
}

function pqfRecords(record = {}) {
  return [
    ...branchRecords(record).flatMap((branch) => asArray(branch.pqfRecords ?? branch.pqf_records)),
    ...asArray(record.pqfRecords ?? record.pqf_records),
  ].filter((pqf) => pqf && typeof pqf === 'object');
}

function distillationRecords(record = {}) {
  return [
    ...branchRecords(record).flatMap((branch) => asArray(branch.distillationRecords ?? branch.distillation_records)),
    ...asArray(record.distillationRecords ?? record.distillation_records),
  ].filter((distillation) => distillation && typeof distillation === 'object');
}

function iterationRecords(record = {}) {
  return branchRecords(record)
    .flatMap((branch) => asArray(branch.iterations))
    .filter((iteration) => iteration && typeof iteration === 'object');
}

function isPqfKept(record = {}) {
  const status = String(record.status ?? record.action ?? '').toLowerCase();
  return record.kept === true || status === 'keep' || status === 'kept';
}

function isPqfReplaced(record = {}) {
  const status = String(record.status ?? record.action ?? '').toLowerCase();
  return record.replaced === true || status === 'replace' || status === 'replaced';
}

function candidateIdFrom(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value !== 'object') return null;
  return value.candidateId ?? value.id ?? value.finalCandidateId ?? null;
}

function finalCandidateId(record = {}) {
  const direct = candidateIdFrom(record.finalCandidateId ?? record.finalCandidate ?? record.winner);
  if (direct) return direct;
  const judgment = asObject(record.finalJudgment ?? record.finalJudgeResult);
  const judged = candidateIdFrom(judgment.selectedCandidateId ?? judgment.winnerCandidateId ?? judgment.candidateId);
  if (judged) return judged;
  return null;
}

function valueTokenEstimate(value) {
  if (!value || typeof value !== 'object') return 0;
  const tokenUsage = asObject(value.tokenUsage ?? value.usage);
  return finiteNumber(
    value.contextTokenEstimate
      ?? value.tokenEstimate
      ?? tokenUsage.totalTokens
      ?? tokenUsage.total_tokens
      ?? tokenUsage.inputTokens
      ?? tokenUsage.input_tokens,
    0,
  );
}

function contextTokenEstimate(record = {}) {
  const direct = valueTokenEstimate(record);
  if (direct > 0) return roundMetric(direct);
  const branchEstimate = branchRecords(record).reduce((sum, branch) => sum + valueTokenEstimate(branch), 0);
  const iterationEstimate = iterationRecords(record).reduce((sum, iteration) => sum + valueTokenEstimate(iteration), 0);
  return roundMetric(branchEstimate + iterationEstimate);
}

function computeMultiplier(record = {}, config = {}) {
  const branches = branchRecords(record);
  const branchCount = branches.length || finiteNumber(record.branchCount, 0);
  const iterations = iterationRecords(record).length || finiteNumber(record.iterationCount, 0);
  const configuredDepth = finiteNumber(config.correctionDepth ?? record.config?.correctionDepth, 0);
  const iterationEstimate = iterations || (branchCount && configuredDepth ? branchCount * configuredDepth : branchCount);
  return roundMetric(iterationEstimate + solutionPoolItems(record).length);
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort((left, right) => left.localeCompare(right));
}

function uniqueInOrder(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function redactText(value) {
  let text = String(value);
  for (const pattern of SECRET_TEXT_PATTERNS) {
    text = text.replace(pattern, REDACTED);
  }
  for (const pattern of LOCAL_PATH_PATTERNS) {
    text = text.replace(pattern, '[local-path-redacted]');
  }
  return text;
}

function sanitizeValue(value, key = '') {
  if (value === undefined || value === null) return value;
  if (SECRET_KEY_PATTERN.test(key)) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (typeof value !== 'object') return undefined;

  return Object.fromEntries(Object.entries(value)
    .filter(([entryKey]) => !HIDDEN_DASHBOARD_KEYS.has(entryKey))
    .map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)])
    .filter(([, entryValue]) => entryValue !== undefined));
}

function auditRefs(record = {}) {
  return asArray(record.auditRefs ?? record.artifactRefs ?? record.artifacts)
    .filter((ref) => ref && typeof ref === 'object')
    .map((ref) => sanitizeValue({
      ...(ref.artifactId ? { artifactId: String(ref.artifactId) } : {}),
      ...(ref.id && !ref.artifactId ? { artifactId: String(ref.id) } : {}),
      ...(ref.path ? { path: String(ref.path) } : {}),
      ...(ref.uri ? { uri: String(ref.uri) } : {}),
      ...(ref.digest ? { digest: String(ref.digest) } : {}),
    }))
    .filter((ref) => Object.keys(ref).length > 0);
}

function recordQuarantineReasons(record = {}, estimate = {}) {
  const reasons = [];
  if (record.evidenceOnly === false) reasons.push('evidence_only_violation');
  if (record.promotionAllowed === true || record.canPromote === true) reasons.push('promotion_claim_present');
  if (estimate.contextOverflowRisk) reasons.push('context_overflow_risk');
  if (estimate.costGateStatus === 'exceeded') reasons.push('compute_multiplier_exceeded');
  reasons.push(...asArray(record.quarantine?.reasons));
  return uniqueInOrder(reasons);
}

export function estimateIcrCompute(record = {}, config = {}) {
  const normalizedConfig = normalizeConfig(record, config);
  const branches = branchRecords(record);
  const iterationCount = iterationRecords(record).length || finiteNumber(record.iterationCount, 0);
  const solutionPoolCount = solutionPoolItems(record).length || finiteNumber(record.solutionPoolCount, 0);
  const distillationCount = distillationRecords(record).length || finiteNumber(record.distillationCount, 0);
  const computeMultiplierEstimate = computeMultiplier(record, normalizedConfig);
  const contextEstimate = contextTokenEstimate(record);
  const contextOverflowRisk = contextEstimate > finiteNumber(normalizedConfig.maxContextTokens, ICR_DEFAULT_CONFIG.maxContextTokens);
  const costGateStatus = computeMultiplierEstimate > finiteNumber(
    normalizedConfig.maxComputeMultiplier,
    ICR_DEFAULT_CONFIG.maxComputeMultiplier,
  )
    ? 'exceeded'
    : 'within_limit';

  return {
    branchCount: branches.length || finiteNumber(record.branchCount, 0),
    iterationCount,
    solutionPoolCount,
    distillationCount,
    computeMultiplierEstimate,
    contextTokenEstimate: contextEstimate,
    contextOverflowRisk,
    costGateStatus,
  };
}

export function extractIcrBottlenecks(record = {}, config = {}) {
  const estimate = estimateIcrCompute(record, config);
  return recordQuarantineReasons(record, estimate);
}

export function summarizeIcrEvidence(record = {}, config = {}) {
  const estimate = estimateIcrCompute(record, config);
  const pqf = pqfRecords(record);
  const evidenceOnly = record.evidenceOnly !== false;
  const promotionAllowed = record.promotionAllowed === true || record.canPromote === true;
  const quarantineReasons = recordQuarantineReasons(record, estimate);

  return {
    branchCount: estimate.branchCount,
    iterationCount: estimate.iterationCount,
    solutionPoolCount: estimate.solutionPoolCount,
    pqfKeptCount: pqf.filter(isPqfKept).length,
    pqfReplacedCount: pqf.filter(isPqfReplaced).length,
    distillationCount: estimate.distillationCount,
    finalCandidateId: finalCandidateId(record),
    computeMultiplierEstimate: estimate.computeMultiplierEstimate,
    contextTokenEstimate: estimate.contextTokenEstimate,
    contextOverflowRisk: estimate.contextOverflowRisk,
    costGateStatus: estimate.costGateStatus,
    evidenceOnly,
    promotionAllowed,
    quarantine: {
      required: Boolean(record.quarantine?.required) || quarantineReasons.length > 0,
      reasons: quarantineReasons,
    },
  };
}

export function sanitizeIcrEvidenceForDashboard(record = {}, config = {}) {
  const summary = summarizeIcrEvidence(record, config);
  const branchIds = sortedUnique(branchRecords(record).map((branch) => branch.branchId ?? branch.id));
  const candidateIds = sortedUnique([
    ...solutionPoolItems(record).map(candidateIdFrom),
    ...asArray(record.finalJudgePacket?.candidates).map(candidateIdFrom),
    summary.finalCandidateId,
  ]);

  return sanitizeValue({
    kind: 'icr_dashboard_evidence_summary',
    lane: 'icr',
    taskId: record.taskId ?? record.task?.taskId ?? record.task?.id ?? null,
    candidateFamilyId: record.candidateFamilyId ?? record.familyId ?? record.id ?? null,
    ...summary,
    branchIds,
    candidateIds,
    auditRefs: auditRefs(record),
    bottlenecks: extractIcrBottlenecks(record, config),
  });
}
