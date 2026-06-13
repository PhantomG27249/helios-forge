import { createHash } from 'node:crypto';

import { normalizeIcrConfig } from './icrContracts.js';

const REDACTED = '[redacted]';
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

function asPositiveInteger(value, fallback, label) {
  const normalized = Number(value ?? fallback);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`invalid_icr_${label}`);
  }
  return normalized;
}

function normalizeConfig(config = {}) {
  const normalized = normalizeIcrConfig(config);
  return {
    ...normalized,
    hypothesisRefreshInterval: asPositiveInteger(
      normalized.hypothesisRefreshInterval,
      normalized.hypothesisRefreshInterval,
      'hypothesis_refresh_interval',
    ),
    pqfInterval: asPositiveInteger(normalized.pqfInterval, normalized.pqfInterval, 'pqf_interval'),
    distillationInterval: asPositiveInteger(
      normalized.distillationInterval,
      normalized.distillationInterval,
      'distillation_interval',
    ),
  };
}

function requireRunner(runners, name) {
  const runner = runners?.[name];
  if (typeof runner !== 'function') {
    throw new Error(`missing_icr_${name}_runner`);
  }
  return runner;
}

function normalizeId(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function sanitizeText(value) {
  let text = String(value);
  for (const pattern of SECRET_TEXT_PATTERNS) {
    text = text.replace(pattern, REDACTED);
  }
  for (const pattern of LOCAL_PATH_PATTERNS) {
    text = text.replace(pattern, '[local-path-redacted]');
  }
  return text;
}

function sanitizeRunnerRecord(value) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeRunnerRecord(entry));
  if (typeof value === 'string') return sanitizeText(value);
  if (!value || typeof value !== 'object') return value;

  const forbiddenKey = /(approval|promot|authority|secret|token|api[-_]?key|authorization|credential)/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !forbiddenKey.test(key))
      .map(([key, entry]) => [key, sanitizeRunnerRecord(entry)]),
  );
}

function timestampFrom(now) {
  if (typeof now === 'function') return now();
  if (typeof now === 'string') return now;
  return new Date().toISOString();
}

function digestFor(value) {
  const serialized = JSON.stringify(value);
  return `icr_input_${createHash('sha256').update(serialized).digest('hex').slice(0, 16)}`;
}

function normalizeArtifactIds(entries) {
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

function normalizeHypothesisPacket(result, fallbackVersion) {
  const packet = result && typeof result === 'object' ? result : { hypotheses: result };
  const hypotheses = Array.isArray(packet.hypotheses)
    ? packet.hypotheses.map(String)
    : [];

  return {
    version: asPositiveInteger(packet.version, fallbackVersion, 'hypothesis_version'),
    hypotheses,
    artifactId: packet.artifactId ? String(packet.artifactId) : null,
  };
}

function normalizeStrategy(result, branch) {
  if (typeof result === 'string') return result;
  return normalizeId(
    result?.strategy ?? result?.name ?? branch?.strategy ?? branch?.strategyId,
    'icr_branch_strategy',
  );
}

function shouldRefreshHypotheses(iterationIndex, interval) {
  return iterationIndex === 1 || (iterationIndex - 1) % interval === 0;
}

function shouldRunInterval(iterationIndex, interval) {
  return iterationIndex % interval === 0;
}

export async function runIcrBranch({
  task = {},
  branch = {},
  config = {},
  runners = {},
  now,
} = {}) {
  const normalizedConfig = normalizeConfig(config);
  const branchId = normalizeId(branch.branchId ?? branch.id, 'icr_branch_1');
  const strategyRunner = requireRunner(runners, 'strategy');
  const hypothesisRunner = requireRunner(runners, 'hypothesis');
  const executorRunner = requireRunner(runners, 'executor');
  const critiqueRunner = requireRunner(runners, 'critique');
  const correctionRunner = requireRunner(runners, 'correction');
  const pqfRunner = requireRunner(runners, 'pqf');
  const distillerRunner = requireRunner(runners, 'distiller');

  const strategyResult = await strategyRunner({
    task: cloneJson(task, {}),
    branch: cloneJson({ ...branch, branchId }, {}),
    config: cloneJson(normalizedConfig, {}),
    now: timestampFrom(now),
  });
  const strategy = normalizeStrategy(strategyResult, branch);

  const iterations = [];
  const pqfRecords = [];
  const distillationRecords = [];
  let activeHypothesisPacket = null;
  let previousCandidate = branch.initialCandidate ?? null;
  let finalCandidate = previousCandidate;

  for (let iterationIndex = 1; iterationIndex <= normalizedConfig.correctionDepth; iterationIndex += 1) {
    if (shouldRefreshHypotheses(iterationIndex, normalizedConfig.hypothesisRefreshInterval)) {
      activeHypothesisPacket = normalizeHypothesisPacket(
        await hypothesisRunner({
          task: cloneJson(task, {}),
          branch: cloneJson({ ...branch, branchId }, {}),
          strategy,
          iterationIndex,
          previousCandidate,
          priorIterations: cloneJson(iterations, []),
          config: cloneJson(normalizedConfig, {}),
          now: timestampFrom(now),
        }),
        activeHypothesisPacket ? activeHypothesisPacket.version + 1 : 1,
      );
    }

    const inputDigest = digestFor({
      taskId: task.taskId ?? task.id ?? null,
      branchId,
      strategy,
      iterationIndex,
      hypothesisVersion: activeHypothesisPacket.version,
      previousCandidate,
    });
    const baseInput = {
      task: cloneJson(task, {}),
      branch: cloneJson({ ...branch, branchId }, {}),
      strategy,
      hypotheses: cloneJson(activeHypothesisPacket, {}),
      iterationIndex,
      previousCandidate,
      inputDigest,
      config: cloneJson(normalizedConfig, {}),
      now: timestampFrom(now),
    };
    const execution = await executorRunner(baseInput);
    const candidateText = sanitizeText(execution?.candidateText ?? execution?.text ?? '');
    const critique = await critiqueRunner({
      ...baseInput,
      candidateText,
      candidateArtifactId: execution?.artifactId ?? null,
    });
    const critiqueSummary = sanitizeText(critique?.summary ?? critique?.critiqueSummary ?? '');
    const critiqueScore = Number(critique?.score ?? execution?.score ?? 0);
    const correction = await correctionRunner({
      ...baseInput,
      candidateText,
      critiqueSummary,
      score: critiqueScore,
      candidateArtifactId: execution?.artifactId ?? null,
      critiqueArtifactId: critique?.artifactId ?? null,
    });
    const correctedCandidateText = String(
      correction?.candidateText ?? correction?.text ?? candidateText,
    );
    const sanitizedCandidateText = sanitizeText(correctedCandidateText);
    const score = Number(correction?.score ?? critiqueScore);
    const stop = Boolean(correction?.stop ?? correction?.stopDecision);
    const iterationRecord = {
      iterationIndex,
      inputDigest,
      hypothesisVersion: activeHypothesisPacket.version,
      candidateText: sanitizedCandidateText,
      critiqueSummary,
      correctionSummary: sanitizeText(correction?.summary ?? correction?.correctionSummary ?? ''),
      score: Number.isFinite(score) ? score : 0,
      artifactIds: normalizeArtifactIds({
        hypothesis: activeHypothesisPacket.artifactId,
        executor: execution?.artifactId,
        critique: critique?.artifactId,
        correction: correction?.artifactId,
      }),
      ...(stop ? { stopReason: 'runner_stop_decision' } : {}),
    };

    iterations.push(iterationRecord);
    previousCandidate = sanitizedCandidateText;
    finalCandidate = sanitizedCandidateText;

    if (shouldRunInterval(iterationIndex, normalizedConfig.pqfInterval)) {
      const pqfRecord = await pqfRunner({
        task: cloneJson(task, {}),
        branch: cloneJson({ ...branch, branchId }, {}),
        strategy,
        iterationIndex,
        iterations: cloneJson(iterations, []),
        activeHypotheses: cloneJson(activeHypothesisPacket.hypotheses, []),
        config: cloneJson(normalizedConfig, {}),
        now: timestampFrom(now),
      });
      pqfRecords.push(sanitizeRunnerRecord(cloneJson(pqfRecord, {})));
    }

    if (shouldRunInterval(iterationIndex, normalizedConfig.distillationInterval)) {
      const distillationRecord = await distillerRunner({
        task: cloneJson(task, {}),
        branch: cloneJson({ ...branch, branchId }, {}),
        strategy,
        iterationIndex,
        iterations: cloneJson(iterations, []),
        activeHypotheses: cloneJson(activeHypothesisPacket.hypotheses, []),
        pqfRecords: cloneJson(pqfRecords, []),
        config: cloneJson(normalizedConfig, {}),
        now: timestampFrom(now),
      });
      distillationRecords.push(sanitizeRunnerRecord(cloneJson(distillationRecord, {})));
    }

    if (stop) break;
  }

  return {
    kind: 'icr_branch_trace',
    lane: 'icr',
    branchId,
    strategy,
    iterations,
    activeHypotheses: cloneJson(activeHypothesisPacket?.hypotheses, []),
    pqfRecords,
    distillationRecords,
    finalCandidate,
    evidenceOnly: true,
    promotionAllowed: false,
  };
}
