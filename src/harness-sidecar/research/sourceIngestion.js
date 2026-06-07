function normalizeSource(source, index) {
  const sourceId = source.sourceId || `src_${index + 1}`;
  const type = source.type || (source.url ? 'external' : 'local');
  const locator = source.locator || source.path || source.url || sourceId;
  const normalized = {
    sourceId,
    title: source.title || sourceId,
    type,
    locator,
  };

  if (source.path) normalized.path = source.path;
  if (source.url) normalized.url = source.url;

  return normalized;
}

function extractSentenceClaims(content = '') {
  return content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalizeClaim(sourceId, claim, index) {
  if (typeof claim === 'string') {
    return {
      claimId: `${sourceId}_claim_${index + 1}`,
      sourceId,
      claim,
      evidence: [sourceId],
    };
  }

  return {
    claimId: claim.claimId || `${sourceId}_claim_${index + 1}`,
    sourceId,
    claim: claim.claim || claim.text || '',
    subject: claim.subject,
    predicate: claim.predicate,
    value: claim.value,
    confidence: claim.confidence,
    evidence: claim.evidence || [sourceId],
  };
}

export function ingestSources({ sources = [] } = {}) {
  const sourceMap = sources.map(normalizeSource);
  const claimCandidates = sources.flatMap((source, sourceIndex) => {
    const sourceId = source.sourceId || `src_${sourceIndex + 1}`;
    const explicitClaims = Array.isArray(source.claims) ? source.claims : [];
    const extractedClaims = explicitClaims.length ? [] : extractSentenceClaims(source.content);

    return [...explicitClaims, ...extractedClaims]
      .map((claim, claimIndex) => normalizeClaim(sourceId, claim, claimIndex));
  });

  return {
    sourceMap,
    claimCandidates,
  };
}
