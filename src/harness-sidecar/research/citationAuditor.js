export function auditCitations({ claims = [] }) {
  const verifiedClaims = claims.filter((claim) => (claim.evidence || []).length > 0);
  const unverifiedClaims = claims.filter((claim) => !(claim.evidence || []).length);

  return {
    verifiedCount: verifiedClaims.length,
    totalCount: claims.length,
    verifiedClaims,
    unverifiedClaims,
  };
}
