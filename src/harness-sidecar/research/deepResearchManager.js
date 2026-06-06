function makeResearchId() {
  return `research_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDeepResearchReport({ question, sources = [] }) {
  const sourceMap = sources.map((source) => ({
    sourceId: source.sourceId,
    title: source.title,
    path: source.path,
  }));

  const claimEvidenceTable = sources.flatMap((source) => (
    (source.claims || []).map((claim, index) => ({
      claimId: `${source.sourceId}_claim_${index + 1}`,
      claim,
      evidence: [source.sourceId],
    }))
  ));

  return {
    researchId: makeResearchId(),
    question,
    sourceMap,
    claimEvidenceTable,
    contradictions: [],
    implementationHandoff: {
      recommendations: claimEvidenceTable.length
        ? ['Convert verified claims into implementation tasks.']
        : ['Collect sources before implementation planning.'],
    },
  };
}
