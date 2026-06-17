function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function stripPromotionClaims(value) {
  if (Array.isArray(value)) return value.map(stripPromotionClaims);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (['canPromote', 'promotionAuthority', 'activeWorkspaceMutation', 'applied', 'durableApplyApproved'].includes(key)) {
      return [key, false];
    }
    return [key, stripPromotionClaims(child)];
  }));
}

function evidenceOnlyFields(value = {}) {
  return {
    ...value,
    canPromote: false,
    promotionAuthority: false,
    activeWorkspaceMutation: false,
    applied: false,
    durableApplyApproved: false,
  };
}

function sanitizePromotionLoopResult(promotionLoopResult) {
  if (!promotionLoopResult) return null;
  const sanitized = stripPromotionClaims(promotionLoopResult);
  if (sanitized.candidate) {
    sanitized.candidate = evidenceOnlyFields(sanitized.candidate);
  }
  if (sanitized.proposal) {
    sanitized.proposal = evidenceOnlyFields(sanitized.proposal);
  }
  return sanitized;
}

export function coordinateRecursiveEvolution({
  replayReports = [],
  campaignResults = [],
  promotionLoopResult = null,
} = {}) {
  const normalizedReplayReports = normalizeList(replayReports);
  const normalizedCampaignResults = stripPromotionClaims(normalizeList(campaignResults));
  const normalizedPromotionLoopResult = sanitizePromotionLoopResult(promotionLoopResult);

  const sources = [];
  if (normalizedReplayReports.length) sources.push('replay');
  if (normalizedCampaignResults.length) sources.push('campaign');
  if (normalizedPromotionLoopResult) sources.push('promotion_loop');

  return {
    schemaVersion: 1,
    sources,
    replayReports: normalizedReplayReports,
    campaignResults: normalizedCampaignResults,
    promotionLoopResult: normalizedPromotionLoopResult,
    evidenceOnly: true,
    canPromote: false,
    promotionAuthority: false,
    activeWorkspaceMutation: false,
    authority: 'evidence_only',
  };
}
