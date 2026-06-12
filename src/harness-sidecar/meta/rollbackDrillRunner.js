import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';
import { recordRollbackDrill } from './governanceLoop.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function safeId(value, fallback = 'candidate') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function containsRedactedValue(value) {
  if (typeof value === 'string') return value === '[redacted]' || value === '[redacted:path]' || value.includes('[redacted');
  if (Array.isArray(value)) return value.some((item) => containsRedactedValue(item));
  if (value && typeof value === 'object') return Object.values(value).some((item) => containsRedactedValue(item));
  return false;
}

function safePayload(value) {
  return quarantineModelVisiblePayload(value, { maxStringLength: 1000 }).value;
}

function normalizeArtifact(artifact = {}) {
  const safe = safePayload(artifact);
  if (containsRedactedValue(safe)) return null;
  const hash = safe.hash || safe.artifactHash || safe.sha256 || safe.checksum;
  if (!hash) return null;
  return safe;
}

async function runStep(fn, input, errors) {
  if (typeof fn !== 'function') return null;
  try {
    return safePayload(await fn(input));
  } catch (error) {
    errors.push(String(error?.message || error));
    return null;
  }
}

export async function runRollbackDrill({
  candidate = {},
  captureBefore,
  applyCandidate,
  rollbackCandidate,
  verifyRestore,
  recordArtifact,
  now = () => new Date(),
} = {}) {
  const candidateId = safeId(candidate.candidateId || candidate.id, 'candidate');
  const startedAt = now().toISOString();
  const errors = [];
  const before = await runStep(captureBefore, { candidate }, errors);
  const apply = await runStep(applyCandidate, { candidate, before }, errors);
  const rollback = await runStep(rollbackCandidate, { candidate, before, apply }, errors);
  const restoreVerified = typeof verifyRestore === 'function'
    ? Boolean(await runStep(verifyRestore, { candidate, before, apply, rollback }, errors))
    : false;
  const rawArtifacts = typeof recordArtifact === 'function'
    ? asArray(await runStep(recordArtifact, { candidate, before, apply, rollback, restoreVerified }, errors))
    : [];
  const artifacts = rawArtifacts.map(normalizeArtifact).filter(Boolean);
  const completedAt = now().toISOString();
  const base = recordRollbackDrill({
    candidateId,
    startedAt,
    completedAt,
    restoreVerified,
    artifacts,
    notes: safePayload(errors.join('; ')),
  });
  const blockers = [
    restoreVerified ? null : 'restore_verification_failed',
    artifacts.length ? null : 'rollback_artifact_required',
    errors.length ? 'rollback_error' : null,
  ].filter(Boolean);

  return {
    ...base,
    rollbackVerified: restoreVerified,
    status: blockers.length ? 'failed' : 'passed',
    reversible: blockers.length ? false : base.reversible,
    blockers,
    errors: safePayload(errors),
    evidenceOnly: true,
    authority: 'evidence_only',
    canPromote: false,
    canApply: false,
  };
}
