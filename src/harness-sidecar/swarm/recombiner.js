function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

export function recombineApprovedOutputs({ taskId, reviews = [] } = {}) {
  const approved = reviews
    .filter((review) => review.approved)
    .sort((left, right) => (right.score || 0) - (left.score || 0)
      || String(left.attemptId).localeCompare(String(right.attemptId)));

  const summaries = approved
    .map((review) => review.output?.summary)
    .filter(Boolean);

  return {
    taskId,
    ready: approved.length > 0,
    sourceAttemptIds: approved.map((review) => review.attemptId),
    patches: approved.map((review) => review.output?.patch).filter(Boolean),
    summary: summaries.join(' '),
    verifierEvidence: unique(approved.flatMap((review) => review.verifierEvidence || review.output?.verifierEvidence || [])),
    rejectedAttemptIds: reviews
      .filter((review) => !review.approved)
      .map((review) => review.attemptId),
  };
}
