function claimEvidence(claim) {
  return claim.evidence || [];
}

function isHighNovelty(claim) {
  return claim.novelty === 'high' || claim.noveltyScore >= 0.75;
}

function hasOnlyFigureEvidence(claim, figureIds) {
  const evidence = claimEvidence(claim);
  return evidence.length > 0
    && evidence.every((item) => item.figureId && figureIds.has(item.figureId));
}

function riskLevelFor(flags) {
  if (flags.some((flag) => flag.severity === 'high')) return 'high';
  if (flags.some((flag) => flag.severity === 'medium')) return 'medium';
  return 'low';
}

export function assessNoveltyAndRisk({
  claims = [],
  contradictions = [],
  figureCandidates = [],
} = {}) {
  const figureIds = new Set(figureCandidates.map((figure) => figure.figureId));
  const flags = [];

  for (const claim of claims) {
    if (isHighNovelty(claim) && claimEvidence(claim).length === 0) {
      flags.push({
        kind: 'unsupported_high_novelty',
        severity: 'high',
        claimId: claim.claimId,
        message: `High novelty claim lacks evidence: ${claim.claimId}`,
      });
    }

    if (hasOnlyFigureEvidence(claim, figureIds)) {
      flags.push({
        kind: 'figure_only_evidence',
        severity: 'medium',
        claimId: claim.claimId,
        message: `Claim relies only on figure evidence: ${claim.claimId}`,
      });
    }
  }

  for (const contradiction of contradictions) {
    flags.push({
      kind: 'contradiction_requires_review',
      severity: 'high',
      contradictionId: contradiction.contradictionId,
      claimIds: contradiction.claimIds || [],
      message: `Contradiction requires review: ${contradiction.contradictionId}`,
    });
  }

  flags.sort((a, b) => {
    const severityRank = { high: 0, medium: 1, low: 2 };
    const kindRank = {
      unsupported_high_novelty: 0,
      contradiction_requires_review: 1,
      figure_only_evidence: 2,
    };
    return severityRank[a.severity] - severityRank[b.severity]
      || (kindRank[a.kind] ?? 99) - (kindRank[b.kind] ?? 99)
      || a.kind.localeCompare(b.kind);
  });

  return {
    riskLevel: riskLevelFor(flags),
    flags,
  };
}
