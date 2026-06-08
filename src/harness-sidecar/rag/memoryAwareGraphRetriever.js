function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function queryTerms(query) {
  return [...new Set(String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length >= 2))];
}

function nodeText(node = {}) {
  return [
    node.kind,
    node.type,
    node.label,
    node.text,
    node.path,
    node.subject,
    node.relation,
    node.object,
    node.schemaId,
    node.factId,
    node.passageId,
  ].filter(Boolean).join(' ').toLowerCase();
}

function estimateTokens(node = {}) {
  return Math.max(1, Math.ceil(nodeText(node).length / 4));
}

function labelIdPart(node = {}) {
  return node.factId || node.schemaId || node.passageId || node.id || node.label || 'unknown';
}

function sourceLabelFor(node = {}) {
  if (node.kind === 'schema') return `memgraph:schema:${labelIdPart(node)}`;
  if (node.kind === 'fact') return `memgraph:fact:${labelIdPart(node)}`;
  if (node.kind === 'passage') return `memgraph:passage:${labelIdPart(node)}`;
  return `memgraph:${node.kind || 'node'}:${labelIdPart(node)}`;
}

function seedScore(node, terms) {
  if (terms.length === 0) return 0;
  const text = nodeText(node);
  const matches = terms.filter((term) => text.includes(term)).length;
  if (matches === 0) return 0;
  const base = matches / terms.length;
  const activeBoost = node.kind === 'fact' && node.status === 'active' ? 0.35 : 0;
  const pendingPenalty = node.kind === 'fact' && node.status === 'pending' ? -0.25 : 0;
  const passageBoost = node.kind === 'passage' ? 0.1 : 0;
  return Math.max(0, base + activeBoost + pendingPenalty + passageBoost);
}

function buildAdjacency(graph = {}) {
  const adjacency = new Map();
  for (const node of normalizeList(graph.nodes)) {
    adjacency.set(node.id, []);
  }
  for (const edge of normalizeList(graph.edges)) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    const bridgeWeight = edge.type === 'memgraph_bridge' ? 0.12 : 0.45;
    adjacency.get(edge.from).push({ id: edge.to, weight: bridgeWeight, edge });
    adjacency.get(edge.to).push({ id: edge.from, weight: bridgeWeight, edge });
  }
  return adjacency;
}

function normalizeScores(scores) {
  const values = [...scores.values()];
  const max = Math.max(0, ...values);
  if (max === 0) return scores;
  const normalized = new Map();
  for (const [id, score] of scores.entries()) normalized.set(id, Math.max(0, Math.min(1, score / max)));
  return normalized;
}

function provenanceFor(node = {}, graph = {}) {
  const own = normalizeList(node.provenance);
  if (node.kind !== 'fact') return own;
  const passageEdges = normalizeList(graph.edges)
    .filter((edge) => edge.from === node.id && edge.type === 'evidenced_by')
    .flatMap((edge) => normalizeList(edge.provenance));
  return [...new Set([...own, ...passageEdges])].sort();
}

function reasonFor(node, seed, bridgeOnly) {
  const reasons = [`kind:${node.kind || 'node'}`];
  if (seed > 0) reasons.push('query_seed_match');
  if (node.kind === 'fact' && node.status === 'active') reasons.push('active_fact');
  if (node.kind === 'fact' && node.status === 'pending') reasons.push('pending_fact');
  if (bridgeOnly) reasons.push('bridge_only');
  return reasons;
}

export function retrieveMemoryAwareGraphContext({
  graph,
  query,
  maxItems = 8,
  restartProbability = 0.15,
  iterations = 12,
  maxBridgeItems = 1,
} = {}) {
  const nodes = normalizeList(graph?.nodes);
  if (nodes.length === 0 || maxItems <= 0) return [];
  const terms = queryTerms(query);
  const restart = Math.max(0, Math.min(1, Number(restartProbability) || 0.15));
  const safeIterations = Math.max(1, Math.floor(Number(iterations) || 12));
  const adjacency = buildAdjacency(graph);
  const seeds = new Map(nodes.map((node) => [node.id, seedScore(node, terms)]));
  let scores = new Map(seeds);

  for (let iteration = 0; iteration < safeIterations; iteration += 1) {
    const next = new Map(nodes.map((node) => [node.id, restart * (seeds.get(node.id) || 0)]));
    for (const node of nodes) {
      const outgoing = adjacency.get(node.id) || [];
      if (outgoing.length === 0) continue;
      const totalWeight = outgoing.reduce((sum, item) => sum + item.weight, 0) || 1;
      for (const edge of outgoing) {
        next.set(edge.id, (next.get(edge.id) || 0) + ((1 - restart) * (scores.get(node.id) || 0) * edge.weight / totalWeight));
      }
    }
    scores = next;
  }

  const normalized = normalizeScores(scores);
  let bridgeOnlyCount = 0;
  return nodes
    .map((node) => {
      const seed = seeds.get(node.id) || 0;
      const score = normalized.get(node.id) || 0;
      const bridgeOnly = seed === 0 && score > 0 && node.kind === 'entity';
      return {
        ...node,
        id: node.id,
        source: 'memory_graph',
        sourceLabel: sourceLabelFor(node),
        type: node.kind || node.type,
        label: node.label,
        summary: node.label || node.text || '',
        provenance: provenanceFor(node, graph),
        reasons: reasonFor(node, seed, bridgeOnly),
        score,
        tokensEstimated: node.tokensEstimated || estimateTokens(node),
        bridgeOnly,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => (
      (right.sourceLabel.startsWith('memgraph:fact:') ? 1 : 0) - (left.sourceLabel.startsWith('memgraph:fact:') ? 1 : 0)
      || right.score - left.score
      || (left.status === 'active' ? -1 : 0) - (right.status === 'active' ? -1 : 0)
      || left.sourceLabel.localeCompare(right.sourceLabel)
    ))
    .filter((item) => {
      if (!item.bridgeOnly) return true;
      bridgeOnlyCount += 1;
      return bridgeOnlyCount <= maxBridgeItems;
    })
    .slice(0, maxItems)
    .map(({ bridgeOnly, ...item }) => item);
}

