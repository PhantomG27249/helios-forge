function normalizeDiscoveredSource(source, index, defaultType) {
  const sourceId = source.sourceId || `${defaultType}_${index + 1}`;
  const locator = source.locator || source.path || source.url || sourceId;

  return {
    sourceId,
    title: source.title || sourceId,
    type: source.type || defaultType,
    path: source.path,
    url: source.url,
    locator,
  };
}

export function discoverSources({
  brief,
  localSources = [],
  sourceList = [],
  externalQueries = [],
  approvedExternalDiscovery = false,
} = {}) {
  const hasExternalRequests = externalQueries.length > 0;

  if (hasExternalRequests && !approvedExternalDiscovery) {
    return {
      briefId: brief?.briefId || null,
      status: 'approval_required',
      requiresApproval: true,
      approval: {
        reason: 'external_discovery_requested',
        externalQueries,
      },
      sources: [],
    };
  }

  const local = localSources.map((source, index) => normalizeDiscoveredSource(source, index, 'local'));
  const listed = sourceList.map((source, index) => normalizeDiscoveredSource(source, index, 'source_list'));
  const external = approvedExternalDiscovery
    ? externalQueries.map((query, index) => ({
      sourceId: `external_query_${index + 1}`,
      title: query,
      type: 'external_query',
      locator: query,
      approved: true,
    }))
    : [];

  return {
    briefId: brief?.briefId || null,
    status: 'ready_for_ingestion',
    requiresApproval: false,
    sources: [...local, ...listed, ...external],
  };
}
