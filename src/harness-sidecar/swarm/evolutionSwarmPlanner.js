import { seedAttemptStrategies } from '../bes/strategySeeder.js';
import { runBesLaneRuntime } from '../bes/laneRuntime.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function archiveEntries(evolutionArchive) {
  if (Array.isArray(evolutionArchive)) return evolutionArchive;
  return asArray(evolutionArchive?.archive);
}

function scoreValue(entry = {}) {
  const raw = entry.bes?.goalScore?.score
    ?? entry.goalScore?.score
    ?? entry.evaluation?.score
    ?? entry.metrics?.combinedScore
    ?? entry.score
    ?? 0;
  const score = Number(raw);
  return Number.isFinite(score) ? score : 0;
}

function clampBudgetWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.3;
  return Math.max(0.1, Math.min(1, number));
}

function goalScoreForEntry(entry = {}) {
  const goalScore = entry.bes?.goalScore || entry.goalScore || {};
  return {
    ...goalScore,
    score: Number.isFinite(Number(goalScore.score)) ? Number(goalScore.score) : scoreValue(entry),
  };
}

function entryId(entry = {}, fallback) {
  return String(entry.candidateId || entry.id || entry.genome?.id || fallback);
}

function strategyForEntry(entry = {}, fallback) {
  return entry.genome?.strategy
    || entry.action?.strategy
    || entry.action?.name
    || entry.strategy
    || entry.name
    || fallback;
}

function textFrom(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasVisualSignal({ entry = {}, taskType = '' } = {}) {
  const haystack = [
    taskType,
    entry.specialization,
    entry.strategy,
    entry.name,
    entry.goalId,
    entry.goal,
    entry.objective,
    entry.description,
    entry.bes,
    entry.goalScore,
    entry.evidence,
    entry.visual,
    entry.verifier,
  ].map(textFrom).join(' ').toLowerCase();
  return /\b(visual|vlm|screenshot|artifact|ocr|layout|image|pdf)\b/.test(haystack);
}

function compareEntries(left, right) {
  if ((left.correct !== false) !== (right.correct !== false)) {
    return left.correct === false ? 1 : -1;
  }
  const scoreDelta = scoreValue(right) - scoreValue(left);
  if (scoreDelta !== 0) return scoreDelta;
  return entryId(left, '').localeCompare(entryId(right, ''));
}

function hasPlannerInputs({ evolutionArchive, bidirectionalBes }) {
  return archiveEntries(evolutionArchive).length > 0 || asArray(bidirectionalBes?.frontier).length > 0;
}

function frontierGapEntries(bidirectionalBes = {}) {
  return asArray((bidirectionalBes || {}).frontier).filter((candidate) => {
    const missingGoalIds = asArray(candidate.goalScore?.missingGoalIds);
    const failedEvidence = asArray(candidate.evidence).some((entry) => entry?.passed === false);
    return missingGoalIds.length > 0 || failedEvidence;
  });
}

function normalizeAttempt({ entry, taskId, taskType, index, source, fallbackAttempt = {} }) {
  const candidateId = entryId(entry, `${source}_${index + 1}`);
  const goalScore = goalScoreForEntry(entry);
  const score = scoreValue(entry);
  const budgetWeight = clampBudgetWeight(entry.budgetWeight ?? score);
  const adaptiveSearch = entry.adaptiveSearch || fallbackAttempt.adaptiveSearch || null;

  return {
    attemptId: `attempt_${index + 1}`,
    taskId,
    candidateId,
    strategy: strategyForEntry(entry, candidateId),
    budgetWeight,
    status: 'pending',
    verifierPassed: false,
    score: 0,
    profileId: entry.profileId || entry.genome?.strategy?.profileId || fallbackAttempt.profileId,
    lineage: entry.lineage || null,
    goalScore,
    islandId: entry.islandId || entry.island || 'island_unassigned',
    specialization: hasVisualSignal({ entry, taskType })
      ? 'visual-specialist'
      : (entry.specialization || fallbackAttempt.specialization || 'implementer'),
    novelty: entry.novelty,
    ...(adaptiveSearch ? { adaptiveSearch } : {}),
    planning: {
      strategy: source,
      rank: index + 1,
      score,
      candidateId,
      correct: entry.correct !== false,
      missingGoalIds: asArray(goalScore.missingGoalIds),
    },
  };
}

function chooseDiverseEntries(entries, maxAttempts) {
  const sorted = entries.slice().sort(compareEntries);
  const selected = [];
  const seenIds = new Set();
  const seenIslands = new Set();
  const islandCount = new Set(sorted.map((entry) => entry.islandId || entry.island).filter(Boolean)).size;
  const diversityTarget = Math.min(maxAttempts, Math.min(2, islandCount));

  for (const entry of sorted) {
    const islandId = entry.islandId || entry.island;
    if (!islandId || seenIslands.has(islandId)) continue;
    selected.push(entry);
    seenIds.add(entryId(entry, ''));
    seenIslands.add(islandId);
    if (selected.length >= diversityTarget) break;
  }

  for (const entry of sorted) {
    if (selected.length >= maxAttempts) break;
    const id = entryId(entry, '');
    if (seenIds.has(id)) continue;
    selected.push(entry);
    seenIds.add(id);
  }

  return selected;
}

function seededFallback({ taskId, taskType, maxAttempts }) {
  return seedAttemptStrategies({ taskType, maxAttempts }).map((strategy, index) => ({
    attemptId: `attempt_${index + 1}`,
    taskId,
    strategy: strategy.name,
    profileId: strategy.profileId,
    budgetWeight: strategy.budgetWeight,
    status: 'pending',
    verifierPassed: false,
    score: 0,
  }));
}

export function planEvolutionSwarmAttempts({
  taskId,
  taskType = 'general',
  maxAttempts = 4,
  evolutionArchive = [],
  bidirectionalBes = null,
  rhoCoreset = null,
  fallbackAttempts = [],
} = {}) {
  if (!hasPlannerInputs({ evolutionArchive, bidirectionalBes })) {
    return fallbackAttempts.length
      ? fallbackAttempts
      : seededFallback({ taskId, taskType, maxAttempts });
  }

  const gaps = frontierGapEntries(bidirectionalBes).filter((candidate) => {
    const id = entryId(candidate, '');
    return !archiveEntries(evolutionArchive).some((entry) => entryId(entry, '') === id);
  });
  const archiveLimit = gaps.length > 0 && maxAttempts > 1 ? maxAttempts - 1 : maxAttempts;
  const archive = chooseDiverseEntries(archiveEntries(evolutionArchive), Math.max(0, archiveLimit));
  const entries = [
    ...archive.map((entry) => ({ entry, source: 'evolution_archive' })),
    ...gaps.map((entry) => ({ entry, source: 'bes_frontier_gap' })),
  ].slice(0, Math.max(0, maxAttempts));

  return entries.map(({ entry, source }, index) => normalizeAttempt({
    entry: {
      ...entry,
      rhoCaseIds: asArray(rhoCoreset?.items).map((item) => item.caseId || item.id).filter(Boolean),
    },
    taskId,
    taskType,
    index,
    source,
    fallbackAttempt: fallbackAttempts[index] || {},
  }));
}

function laneCases(value = {}) {
  if (Array.isArray(value)) return value;
  return value.items || value.cases || value.hardCases || [];
}

function evaluateSwarmAttempt(candidate = {}) {
  const reasons = [];
  let score = 0.25;

  if (candidate.specialization) {
    reasons.push('role coverage');
    score += 0.15;
  }
  if (candidate.strategy) {
    reasons.push('handoff contract');
    score += 0.15;
  }
  if (candidate.islandId && candidate.islandId !== 'island_unassigned') {
    reasons.push('diversity');
    score += 0.15;
  }
  if ((candidate.planning?.missingGoalIds || []).length === 0) {
    reasons.push('hard-case coverage');
    score += 0.15;
  }
  if (Number.isFinite(Number(candidate.budgetWeight))) {
    reasons.push('budget weight assigned');
    score += 0.1;
  }

  return {
    score: Math.min(1, score),
    reasons,
    safety: { status: 'shadow_only', reasons: ['swarm_attempt_plan_only'] },
    promotable: false,
  };
}

export async function runSwarmPolicyBesLane({
  taskId = 'swarm_policy_bes',
  taskType = 'general',
  evolutionArchive = [],
  bidirectionalBes = null,
  rhoCoreset = null,
  hardCases = [],
  maxCandidates = 4,
  now,
} = {}) {
  const candidates = planEvolutionSwarmAttempts({
    taskId,
    taskType,
    maxAttempts: maxCandidates,
    evolutionArchive,
    bidirectionalBes,
    rhoCoreset,
  });
  const normalizedHardCases = hardCases.length ? hardCases : laneCases(rhoCoreset);

  return runBesLaneRuntime({
    lane: 'swarm',
    taskId,
    candidates,
    hardCases: normalizedHardCases,
    now,
    denseSubgoals: [
      { id: 'role_coverage', requiredEvidence: 'role coverage' },
      { id: 'handoff_evidence', requiredEvidence: 'handoff contract' },
      { id: 'diversity', requiredEvidence: 'diversity' },
      { id: 'hard_case_coverage', requiredEvidence: 'hard-case coverage' },
    ],
    evaluator: ({ candidate }) => evaluateSwarmAttempt(candidate),
  });
}
