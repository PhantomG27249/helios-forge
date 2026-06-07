function makeActionItem(row, index) {
  return {
    actionId: `action_${index + 1}`,
    task: `Implement from research claim: ${row.claim || row.text || row.claimId}`,
    claimId: row.claimId || null,
    evidence: row.evidence || [],
  };
}

function isUncertain(row) {
  return (row.confidence != null && row.confidence < 0.6) || !(row.evidence || []).length;
}

export function createImplementationHandoff({
  report = {},
  contradictions = [],
} = {}) {
  const claimRows = report.claimEvidenceTable || [];
  const actionItems = claimRows.map(makeActionItem);
  const uncertainties = claimRows
    .filter(isUncertain)
    .map((row) => ({
      claimId: row.claimId || null,
      claim: row.claim || row.text || '',
      confidence: row.confidence ?? null,
      reason: !(row.evidence || []).length ? 'missing_evidence' : 'low_confidence',
    }));

  return {
    status: contradictions.length || uncertainties.length ? 'ready_with_cautions' : 'ready',
    question: report.question || '',
    actionItems,
    uncertainties,
    contradictions,
    recommendations: actionItems.map((item) => item.task),
  };
}
