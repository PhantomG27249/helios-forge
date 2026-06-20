import { loadRecentIcrEvidence, sanitizeIcrFamilyForDashboard } from '../icr/icrEvidenceStore.js';
import { summarizeIcrEvidence } from '../icr/icrEvidence.js';

const DEFAULT_MAX_CHARS = 512;

function truncate(text, maxChars = DEFAULT_MAX_CHARS) {
  const body = String(text || '');
  if (body.length <= maxChars) return body;
  return `${body.slice(0, Math.max(0, maxChars - 3))}...`;
}

export async function loadIcrBridgeContext({
  workspaceRoot,
  harnessConfig = {},
  deps = {},
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const icrEnabled = harnessConfig?.features?.icr?.enabled === true
    || harnessConfig?.icr?.enabled === true;
  if (!icrEnabled) return null;

  const loadRecent = deps.loadRecentIcrEvidence || loadRecentIcrEvidence;
  const sanitize = deps.sanitizeIcrFamilyForDashboard || sanitizeIcrFamilyForDashboard;
  const summarize = deps.summarizeIcrEvidence || summarizeIcrEvidence;

  const records = await loadRecent(workspaceRoot, { limit: 1 });
  if (!records.length) {
    return {
      familyCount: 0,
      summary: null,
      evidenceOnly: true,
      canPromote: false,
      authority: 'advisory_only',
    };
  }

  const sanitized = sanitize(records[0], harnessConfig.icr || harnessConfig.features?.icr || {});
  const summaryObj = summarize(sanitized, harnessConfig.icr || {});
  const summary = truncate(summaryObj?.headline || summaryObj?.summary || JSON.stringify({
    familyId: sanitized.familyId,
    branchCount: sanitized.branchCount,
    status: sanitized.status,
  }));

  return {
    familyCount: records.length,
    latestFamilyId: sanitized.familyId || sanitized.id || null,
    summary,
    evidenceOnly: true,
    canPromote: false,
    authority: 'advisory_only',
  };
}
