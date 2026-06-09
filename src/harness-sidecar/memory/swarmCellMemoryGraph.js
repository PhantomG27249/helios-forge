import { localGraphToMemoryProposal } from './localMemoryGraph.js';

export const SWARM_CELL_MEMORY_GRAPH_SCHEMA_VERSION = 1;

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(normalizeList(values).map(String))].sort();
}

function factKey(fact = {}) {
  return [
    String(fact.subject || ''),
    String(fact.relation || fact.predicate || ''),
    String(fact.object || ''),
  ].join('\0');
}

function schemaKey(schema = {}) {
  return [
    String(schema.headType || schema.subjectType || 'entity'),
    String(schema.relation || schema.predicate || 'related_to'),
    String(schema.tailType || schema.objectType || 'entity'),
  ].join('\0');
}

function mergePassage(passages, passage = {}) {
  const passageId = passage.passageId || passage.id;
  if (!passageId) return;
  const existing = passages.get(passageId) || {};
  passages.set(passageId, {
    ...existing,
    ...passage,
    id: passageId,
    passageId,
  });
}

function mergeSchema(schemas, schema = {}) {
  const key = schemaKey(schema);
  const existing = schemas.get(key) || {};
  schemas.set(key, {
    ...existing,
    ...schema,
    headType: schema.headType || schema.subjectType || existing.headType || 'entity',
    relation: schema.relation || schema.predicate || existing.relation || 'related_to',
    tailType: schema.tailType || schema.objectType || existing.tailType || 'entity',
    frequency: (existing.frequency || 0) + (Number.isFinite(Number(schema.frequency)) ? Number(schema.frequency) : 1),
    status: existing.status === 'stable' || schema.status === 'stable' ? 'stable' : (schema.status || existing.status || 'candidate'),
  });
}

function mergeFact(facts, fact = {}, agentId) {
  const relation = fact.relation || fact.predicate || 'related_to';
  const key = factKey({ ...fact, relation });
  const existing = facts.get(key) || {};
  facts.set(key, {
    ...existing,
    ...fact,
    subject: String(fact.subject || existing.subject || ''),
    subjectType: fact.subjectType || fact.headType || existing.subjectType || 'entity',
    relation,
    predicate: relation,
    object: String(fact.object || existing.object || ''),
    objectType: fact.objectType || fact.tailType || existing.objectType || 'entity',
    passageIds: uniqueSorted([...normalizeList(existing.passageIds), ...normalizeList(fact.passageIds)]),
    supportingAgentIds: uniqueSorted([...normalizeList(existing.supportingAgentIds), agentId]),
    status: 'cell_pending',
  });
}

export function mergeSwarmCellMemoryGraphs({ cellId, localGraphs = [] } = {}) {
  if (!cellId) throw new Error('cellId is required');
  const passages = new Map();
  const schemas = new Map();
  const facts = new Map();
  const agentIds = [];

  for (const graph of normalizeList(localGraphs)) {
    const proposal = localGraphToMemoryProposal(graph);
    agentIds.push(proposal.agentId);
    for (const passage of normalizeList(proposal.passages)) mergePassage(passages, passage);
    for (const schema of normalizeList(proposal.schemas)) mergeSchema(schemas, schema);
    for (const fact of normalizeList(proposal.facts)) mergeFact(facts, fact, proposal.agentId);
  }

  return {
    schemaVersion: SWARM_CELL_MEMORY_GRAPH_SCHEMA_VERSION,
    cellId,
    agentIds: uniqueSorted(agentIds),
    passages: [...passages.values()].sort((left, right) => left.passageId.localeCompare(right.passageId)),
    schemas: [...schemas.values()].sort((left, right) => schemaKey(left).localeCompare(schemaKey(right))),
    facts: [...facts.values()].sort((left, right) => factKey(left).localeCompare(factKey(right))),
  };
}
