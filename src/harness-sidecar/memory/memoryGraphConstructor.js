function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function normalizeToken(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function nodeId(kind, value) {
  return `memgraph_${kind}_${normalizeToken(value)}`;
}

function upsertNode(nodes, node) {
  const existing = nodes.get(node.id) || {};
  nodes.set(node.id, {
    ...existing,
    ...node,
    provenance: [...new Set([...normalizeList(existing.provenance), ...normalizeList(node.provenance)])].sort(),
  });
}

function edgeKey(edge) {
  return `${edge.from}\0${edge.to}\0${edge.type}\0${edge.reason || ''}`;
}

function upsertEdge(edges, edge) {
  const key = edgeKey(edge);
  const existing = edges.get(key) || {};
  edges.set(key, {
    ...existing,
    ...edge,
    provenance: [...new Set([...normalizeList(existing.provenance), ...normalizeList(edge.provenance)])].sort(),
  });
}

function activeFacts(layers = {}) {
  return normalizeList(layers.facts).filter((fact) => fact.status === 'active');
}

function textForSimilarity(node = {}) {
  return [node.label, node.type, node.kind].filter(Boolean).join(' ');
}

function addBridge(edges, from, to, reason, provenance = []) {
  if (!from || !to || from === to) return;
  const [left, right] = [from, to].sort();
  upsertEdge(edges, {
    from: left,
    to: right,
    type: 'memgraph_bridge',
    reason,
    provenance,
  });
}

export function constructMemoryGuidedGraph({
  layers,
  similarity = () => 0,
  bridgingThreshold = 0.8,
} = {}) {
  const safeLayers = layers || { schemas: [], facts: [], passages: [] };
  const nodes = new Map();
  const edges = new Map();
  const threshold = Math.max(0, Math.min(1, Number(bridgingThreshold) || 0.8));
  const active = activeFacts(safeLayers);
  const activeFactIds = new Set(active.map((fact) => fact.id));

  for (const schema of normalizeList(safeLayers.schemas)) {
    upsertNode(nodes, {
      id: nodeId('schema', schema.id),
      kind: 'schema',
      schemaId: schema.id,
      label: `${schema.headType} ${schema.relation} ${schema.tailType}`,
      headType: schema.headType,
      relation: schema.relation,
      tailType: schema.tailType,
      status: schema.status || 'candidate',
      frequency: schema.frequency || 1,
    });
  }

  for (const passage of normalizeList(safeLayers.passages)) {
    upsertNode(nodes, {
      id: nodeId('passage', passage.passageId || passage.id),
      kind: 'passage',
      passageId: passage.passageId || passage.id,
      label: passage.text || passage.path || passage.source || passage.artifactId || passage.passageId,
      text: passage.text || '',
      path: passage.path,
      span: passage.span,
      source: passage.source,
      artifactId: passage.artifactId,
    });
  }

  for (const fact of active) {
    const factNodeId = nodeId('fact', fact.id);
    const subjectNodeId = nodeId('entity', fact.subject);
    const objectNodeId = nodeId('entity', fact.object);
    const provenance = normalizeList(fact.passageIds);

    upsertNode(nodes, {
      id: factNodeId,
      kind: 'fact',
      factId: fact.id,
      schemaId: fact.schemaId,
      label: `${fact.subject} ${fact.relation} ${fact.object}`,
      subject: fact.subject,
      relation: fact.relation,
      object: fact.object,
      status: fact.status,
      confidence: fact.confidence,
      passageIds: provenance,
      provenance,
    });
    upsertNode(nodes, {
      id: subjectNodeId,
      kind: 'entity',
      label: fact.subject,
      type: fact.subjectType,
      provenance,
    });
    upsertNode(nodes, {
      id: objectNodeId,
      kind: 'entity',
      label: fact.object,
      type: fact.objectType,
      provenance,
    });
    upsertEdge(edges, {
      from: subjectNodeId,
      to: factNodeId,
      type: 'asserts_subject',
      provenance,
    });
    upsertEdge(edges, {
      from: factNodeId,
      to: objectNodeId,
      type: fact.relation,
      provenance,
    });
    upsertEdge(edges, {
      from: nodeId('schema', fact.schemaId),
      to: factNodeId,
      type: 'governs_fact',
      provenance,
    });
    for (const passageId of provenance) {
      upsertEdge(edges, {
        from: factNodeId,
        to: nodeId('passage', passageId),
        type: 'evidenced_by',
        provenance: [passageId],
      });
    }
  }

  const entityNodes = [...nodes.values()].filter((node) => node.kind === 'entity');
  for (let leftIndex = 0; leftIndex < entityNodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entityNodes.length; rightIndex += 1) {
      const left = entityNodes[leftIndex];
      const right = entityNodes[rightIndex];
      if (left.type && left.type === right.type) {
        addBridge(edges, left.id, right.id, 'compatible_schema_type', [
          ...normalizeList(left.provenance),
          ...normalizeList(right.provenance),
        ]);
      }
      const similarityScore = Number(similarity(left, right, {
        leftText: textForSimilarity(left),
        rightText: textForSimilarity(right),
      }));
      if (Number.isFinite(similarityScore) && similarityScore >= threshold) {
        addBridge(edges, left.id, right.id, 'similarity_above_threshold', [
          ...normalizeList(left.provenance),
          ...normalizeList(right.provenance),
        ]);
      }
    }
  }

  const edgeList = [...edges.values()].sort((left, right) => (
    left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to)
    || left.type.localeCompare(right.type)
    || String(left.reason || '').localeCompare(String(right.reason || ''))
  ));

  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: edgeList,
    stats: {
      schemaCount: normalizeList(safeLayers.schemas).length,
      activeFactCount: activeFactIds.size,
      pendingFactCount: normalizeList(safeLayers.facts).filter((fact) => fact.status !== 'active').length,
      passageCount: normalizeList(safeLayers.passages).length,
      bridgeCount: edgeList.filter((edge) => edge.type === 'memgraph_bridge').length,
    },
  };
}

