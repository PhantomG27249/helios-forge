export const LOCAL_MEMORY_GRAPH_SCHEMA_VERSION = 1;

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function normalizeToken(value) {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function uniqueSorted(values) {
  return [...new Set(normalizeList(values).map(String))].sort();
}

function passageIdFor(observation = {}) {
  return observation.passageId
    || observation.source
    || observation.traceId
    || `local_${normalizeToken(observation.text || observation.subject || 'observation')}`;
}

function factKey(fact = {}) {
  return [
    String(fact.subject || ''),
    String(fact.relation || fact.predicate || ''),
    String(fact.object || ''),
  ].join('\0');
}

function normalizePassage(observation = {}) {
  const passageId = passageIdFor(observation);
  return {
    id: passageId,
    passageId,
    text: observation.text || observation.summary || '',
    source: observation.source,
  };
}

function normalizeFact(observation = {}) {
  const relation = observation.relation || observation.predicate || 'related_to';
  return {
    subject: String(observation.subject || ''),
    subjectType: observation.subjectType || observation.headType || 'entity',
    relation,
    predicate: relation,
    object: String(observation.object || ''),
    objectType: observation.objectType || observation.tailType || 'entity',
    passageIds: uniqueSorted(observation.passageIds || observation.passageId || observation.source),
    status: 'local_pending',
    confidence: Number.isFinite(Number(observation.confidence)) ? Number(observation.confidence) : null,
  };
}

function normalizeSchema(observation = {}) {
  if (!observation.subjectType && !observation.headType && !observation.objectType && !observation.tailType) {
    return null;
  }
  return {
    headType: observation.subjectType || observation.headType || 'entity',
    relation: observation.relation || observation.predicate || 'related_to',
    tailType: observation.objectType || observation.tailType || 'entity',
    frequency: Number.isFinite(Number(observation.frequency)) ? Number(observation.frequency) : 1,
    status: observation.status || 'candidate',
  };
}

export function createLocalMemoryGraph({ agentId, taskId } = {}) {
  if (!agentId) throw new Error('agentId is required');
  return {
    schemaVersion: LOCAL_MEMORY_GRAPH_SCHEMA_VERSION,
    agentId,
    taskId: taskId || null,
    passages: [],
    schemas: [],
    facts: [],
    observations: [],
  };
}

export function addLocalObservation(graph, observation = {}) {
  if (!graph) throw new Error('graph is required');
  graph.observations.push({ ...observation });

  if (observation.text || observation.source || observation.passageId) {
    const passage = normalizePassage(observation);
    const passageIndex = graph.passages.findIndex((item) => item.passageId === passage.passageId);
    if (passageIndex === -1) graph.passages.push(passage);
    else graph.passages[passageIndex] = { ...graph.passages[passageIndex], ...passage };
    graph.passages.sort((left, right) => left.passageId.localeCompare(right.passageId));
  }

  if (observation.kind === 'fact' || (observation.subject && observation.relation && observation.object)) {
    const fact = normalizeFact(observation);
    const key = factKey(fact);
    const factIndex = graph.facts.findIndex((item) => factKey(item) === key);
    if (factIndex === -1) graph.facts.push(fact);
    else {
      graph.facts[factIndex] = {
        ...graph.facts[factIndex],
        ...fact,
        passageIds: uniqueSorted([...graph.facts[factIndex].passageIds, ...fact.passageIds]),
      };
    }
    graph.facts.sort((left, right) => factKey(left).localeCompare(factKey(right)));

    const schema = normalizeSchema(observation);
    if (schema) {
      const schemaKey = [schema.headType, schema.relation, schema.tailType].join('\0');
      const schemaIndex = graph.schemas.findIndex((item) => [item.headType, item.relation, item.tailType].join('\0') === schemaKey);
      if (schemaIndex === -1) graph.schemas.push(schema);
      else graph.schemas[schemaIndex] = { ...graph.schemas[schemaIndex], frequency: (graph.schemas[schemaIndex].frequency || 1) + 1 };
      graph.schemas.sort((left, right) => (
        left.headType.localeCompare(right.headType)
        || left.relation.localeCompare(right.relation)
        || left.tailType.localeCompare(right.tailType)
      ));
    }
  }

  return graph;
}

export function localGraphToMemoryProposal(graph) {
  if (!graph) throw new Error('graph is required');
  return {
    schemaVersion: LOCAL_MEMORY_GRAPH_SCHEMA_VERSION,
    agentId: graph.agentId,
    taskId: graph.taskId || null,
    passages: normalizeList(graph.passages),
    schemas: normalizeList(graph.schemas),
    facts: normalizeList(graph.facts).map((fact) => ({
      ...fact,
      status: fact.status || 'local_pending',
      provenance: uniqueSorted([graph.agentId, graph.taskId]),
    })),
  };
}
