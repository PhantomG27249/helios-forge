function prefixedId(type, value) {
  const text = String(value || '');
  return text.startsWith(`${type}:`) ? text : `${type}:${text}`;
}

function resultFromEdge(graph, nodeId, reason, edge) {
  const node = graph.getNode(nodeId);
  if (!node) {
    return null;
  }

  return {
    ...node,
    reason,
    provenance: [
      ...(edge.provenance || []),
      ...(node.provenance || []),
    ],
  };
}

export function findTestsValidatingFile(graph, filePathOrId) {
  const fileId = prefixedId('file', filePathOrId);
  return graph.findEdges({ to: fileId, type: 'validates' })
    .map((edge) => resultFromEdge(graph, edge.from, `validates ${filePathOrId}`, edge))
    .filter(Boolean)
    .filter((node) => node.type === 'test');
}

export function findSupportingRunsForClaim(graph, claimIdOrText) {
  const claimId = prefixedId('claim', claimIdOrText);
  const claimLabel = claimId.replace(/^claim:/, '');
  return graph.findEdges({ from: claimId, type: 'supported_by' })
    .map((edge) => resultFromEdge(graph, edge.to, `supports claim ${claimLabel}`, edge))
    .filter(Boolean)
    .filter((node) => node.type === 'run');
}

export function queryGraph(graph, query) {
  if (query.type === 'tests_validating_file') {
    return findTestsValidatingFile(graph, query.filePath || query.fileId);
  }
  if (query.type === 'supporting_runs_for_claim') {
    return findSupportingRunsForClaim(graph, query.claimId || query.claim);
  }
  return [];
}
