import { normalizeClaimText } from './claimExtractor.js';

function sourceMapFor(sources) {
  return new Map(sources.map((source) => [source.sourceId, source]));
}

function normalizeBibliography(sources) {
  return sources.map((source) => ({
    sourceId: source.sourceId,
    title: source.title || source.sourceId,
    type: source.type || 'local',
    locator: source.locator || source.path || source.url || source.sourceId,
  }));
}

function verifySpanEvidence(claim, source) {
  const content = source.content || '';
  const quote = claim.quote || claim.claim || '';

  if (claim.span) {
    const spanText = content.slice(claim.span.start, claim.span.end);
    if (spanText === quote) {
      return {
        status: 'supported',
        evidence: [{
          sourceId: source.sourceId,
          quote,
          span: claim.span,
        }],
      };
    }

    return {
      status: 'unsupported',
      reason: 'span_quote_mismatch',
    };
  }

  const start = content.indexOf(quote);
  if (quote && start >= 0) {
    return {
      status: 'supported',
      evidence: [{
        sourceId: source.sourceId,
        quote,
        span: { start, end: start + quote.length },
      }],
    };
  }

  const normalizedContent = normalizeClaimText(content);
  const normalizedClaim = claim.normalizedClaim || normalizeClaimText(claim.claim || quote);
  if (normalizedClaim && normalizedContent.includes(normalizedClaim)) {
    return {
      status: 'supported',
      evidence: [{
        sourceId: source.sourceId,
        quote,
        span: null,
      }],
    };
  }

  return {
    status: 'unsupported',
    reason: 'quote_not_found',
  };
}

export function verifyEvidence({ claims = [], sources = [] } = {}) {
  const sourcesById = sourceMapFor(sources);
  const verifiedClaims = [];
  const unsupportedClaims = [];

  for (const claim of claims) {
    const source = sourcesById.get(claim.sourceId);
    if (!source) {
      unsupportedClaims.push({
        ...claim,
        status: 'unsupported',
        reason: 'missing_source',
      });
      continue;
    }

    const result = verifySpanEvidence(claim, source);
    if (result.status === 'supported') {
      verifiedClaims.push({
        ...claim,
        status: 'supported',
        evidence: result.evidence,
      });
      continue;
    }

    unsupportedClaims.push({
      ...claim,
      status: 'unsupported',
      reason: result.reason,
    });
  }

  return {
    verifiedClaims,
    unsupportedClaims,
    bibliography: normalizeBibliography(sources),
  };
}
