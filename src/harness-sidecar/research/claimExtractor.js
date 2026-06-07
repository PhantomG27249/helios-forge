function normalizeClaimText(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceMatches(content) {
  return [...content.matchAll(/[^.!?\n]+[.!?]|[^.!?\n]+$/g)]
    .map((match) => {
      const raw = match[0];
      const leadingWhitespace = raw.match(/^\s*/)[0].length;
      const trailingWhitespace = raw.match(/\s*$/)[0].length;
      const start = match.index + leadingWhitespace;
      const end = match.index + raw.length - trailingWhitespace;
      const quote = content.slice(start, end);

      return {
        quote,
        span: { start, end },
      };
    })
    .filter((sentence) => sentence.quote.trim().length > 0);
}

export function extractClaims({ sources = [] } = {}) {
  return sources.flatMap((source) => {
    const content = source.content || '';

    return sentenceMatches(content).map((sentence, index) => ({
      claimId: `${source.sourceId}_claim_${index + 1}`,
      sourceId: source.sourceId,
      claim: sentence.quote,
      normalizedClaim: normalizeClaimText(sentence.quote),
      quote: sentence.quote,
      span: sentence.span,
      confidence: 0.72,
    }));
  });
}

export { normalizeClaimText };
