export const ICR_JUDGE_HIDDEN_KEYS = Object.freeze([
  'branch_memory',
  'critique_records',
  'pqf_records',
  'replaced_branches',
  'hypothesis_history',
]);

const REDACTED = '[redacted]';
const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|cookie|client[_-]?secret|refresh[_-]?token)/i;
const SECRET_TEXT_PATTERNS = Object.freeze([
  /\b(?:api[_-]?key|token|secret|password|client[_-]?secret)\s*[:=]\s*['"]?[^'"\s,;}]+/gi,
  /\bauthorization\s*:\s*bearer\s+[^'"\s,;}]+/gi,
  /\bbearer\s+[a-z0-9._~+/=-]{8,}/gi,
  /\bsk-[a-z0-9_-]{6,}/gi,
  /\bgh[pousr]_[a-z0-9_]{6,}/gi,
]);
const LOCAL_PATH_PATTERNS = Object.freeze([
  /\b[a-z]:[\\/](?:[^\\/\s"'<>|:]+[\\/])*[^\\/\s"'<>|:]*/gi,
  /(?<![\w/])\/(?:Users|home|tmp|var|private|mnt)\/[^\s"'<>]+/g,
]);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cloneJson(value, fallback = undefined) {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function sanitizeText(value) {
  let text = String(value ?? '');
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
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
  if (typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value)
    .map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)])
    .filter(([, entryValue]) => entryValue !== undefined));
}

function normalizeId(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function padded(index) {
  return String(index + 1).padStart(3, '0');
}

function rubricFromTask(task = {}) {
  return asArray(task.rubric ?? task.judgeRubric ?? task.acceptanceRubric)
    .map((entry) => String(entry).trim())
    .filter(Boolean);
}

function solutionTextFrom(trace = {}) {
  const solution = trace.solution && typeof trace.solution === 'object' ? trace.solution : {};
  const output = trace.output && typeof trace.output === 'object' ? trace.output : {};
  const finalCandidate = trace.finalCandidate && typeof trace.finalCandidate === 'object'
    ? trace.finalCandidate
    : {};
  const value = solution.text
    ?? solution.answer
    ?? solution.finalAnswer
    ?? finalCandidate.text
    ?? finalCandidate.answer
    ?? finalCandidate.finalAnswer
    ?? trace.finalCandidate
    ?? output.text
    ?? output.answer
    ?? trace.text
    ?? trace.answer
    ?? trace.compactHandoff?.summary
    ?? '';
  return sanitizeText(value ?? '');
}

function isActiveTrace(trace = {}) {
  if (trace.replacement?.active === false) return false;
  if (trace.active === false) return false;
  if (trace.status === 'replaced' || trace.status === 'inactive') return false;
  return true;
}

export function compactIcrVisibleMetrics(metrics = {}) {
  const visibleKeys = [
    'score',
    'confidence',
    'correctness',
    'coverage',
    'costTokens',
    'tokens',
    'latencyMs',
    'durationMs',
    'iterationCount',
    'branchIndex',
  ];
  const compact = {};
  for (const key of visibleKeys) {
    const value = metrics[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      compact[key] = value;
    } else if (typeof value === 'boolean') {
      compact[key] = value;
    }
  }
  return compact;
}

function metricScore(candidate = {}) {
  const metrics = candidate.visibleMetrics ?? {};
  return Number(metrics.score ?? metrics.correctness ?? metrics.confidence ?? 0);
}

function boundedCandidates(candidates, solutionPoolSize) {
  const limit = Math.max(1, Math.floor(Number(solutionPoolSize ?? candidates.length) || candidates.length));
  if (candidates.length <= limit) return candidates;
  return [...candidates]
    .sort((left, right) => (
      metricScore(right) - metricScore(left)
        || String(left.candidateId || '').localeCompare(String(right.candidateId || ''))
    ))
    .slice(0, limit);
}

export function buildIcrSolutionPool({ branchTraces = [], solutionPoolSize } = {}) {
  const allCandidates = asArray(branchTraces).map((trace, index) => {
    const branchId = normalizeId(trace?.branchId, `icr_branch_${padded(index)}`);
    const candidateId = normalizeId(trace?.candidateId, `icr_candidate_${padded(index)}`);
    const text = solutionTextFrom(trace);
    const metrics = compactIcrVisibleMetrics({
      ...(trace?.metrics ?? {}),
      branchIndex: trace?.branch?.index ?? trace?.index ?? index + 1,
    });

    return {
      kind: 'icr_solution_candidate',
      lane: 'icr',
      candidateId,
      branchId,
      status: 'shadow_only',
      active: isActiveTrace(trace),
      text,
      solution: sanitizeValue(cloneJson(trace?.solution ?? { text }, { text })),
      visibleMetrics: metrics,
      lineage: {
        parents: [branchId],
        operator: 'icr_branch_solution',
        compatibleFamily: 'icr',
      },
      bes: {
        candidateUnit: 'icr_solution',
        evidenceOnly: true,
        promotionAuthority: false,
      },
    };
  });
  const candidates = boundedCandidates(allCandidates, solutionPoolSize);

  return {
    kind: 'icr_solution_pool',
    lane: 'icr',
    candidates,
    candidateCount: candidates.length,
    activeCandidateCount: candidates.filter((candidate) => candidate.active).length,
    totalCandidateCount: allCandidates.length,
    solutionPoolSize: Math.max(1, Math.floor(Number(solutionPoolSize ?? candidates.length) || candidates.length)),
  };
}

export function collectIcrReplacedBranches(branchTraces = []) {
  return asArray(branchTraces).flatMap((trace) => (
    asArray(trace?.replaced_branches).map((branch, index) => ({
      ...cloneJson(branch, {}),
      branchId: normalizeId(branch?.branchId ?? branch?.id, `${normalizeId(trace?.branchId, 'icr_branch')}_replaced_${index + 1}`),
    }))
  ));
}

export function buildIcrBlindFinalJudgePacket({ candidates = [], task = {} } = {}) {
  const activeCandidates = asArray(candidates).filter((candidate) => candidate?.active !== false);
  return {
    kind: 'icr_blind_final_judge_packet',
    taskRubric: rubricFromTask(task),
    candidates: activeCandidates.map((candidate) => ({
      candidateId: normalizeId(candidate?.candidateId, 'icr_candidate'),
      branchId: normalizeId(candidate?.branchId, 'icr_branch'),
      text: String(candidate?.text ?? ''),
      visibleMetrics: compactIcrVisibleMetrics(candidate?.visibleMetrics ?? {}),
    })),
    hiddenFromJudge: [...ICR_JUDGE_HIDDEN_KEYS],
  };
}
