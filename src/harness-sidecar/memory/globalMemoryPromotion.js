export const GLOBAL_MEMORY_PROMOTION_SCHEMA_VERSION = 1;

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

function supportCountFor(fact = {}) {
  const agentSupport = uniqueSorted(fact.supportingAgentIds);
  if (agentSupport.length > 0) return agentSupport.length;
  return uniqueSorted(fact.passageIds || fact.passageId).length;
}

export function proposeGlobalMemoryPromotions({ cellGraph, supportThreshold = 2 } = {}) {
  if (!cellGraph) throw new Error('cellGraph is required');
  const threshold = Math.max(1, Math.floor(Number(supportThreshold) || 2));
  const facts = normalizeList(cellGraph.facts)
    .filter((fact) => supportCountFor(fact) >= threshold)
    .map((fact) => ({
      ...fact,
      passageIds: uniqueSorted(fact.passageIds || fact.passageId),
      supportingAgentIds: uniqueSorted(fact.supportingAgentIds),
      status: 'pending',
      cellId: cellGraph.cellId,
    }))
    .sort((left, right) => factKey(left).localeCompare(factKey(right)));

  const supportedSchemaKeys = new Set(facts.map((fact) => schemaKey({
    headType: fact.subjectType,
    relation: fact.relation,
    tailType: fact.objectType,
  })));
  const schemas = normalizeList(cellGraph.schemas)
    .filter((schema) => supportedSchemaKeys.has(schemaKey(schema)))
    .map((schema) => ({
      ...schema,
      frequency: Math.max(Number(schema.frequency) || 1, threshold),
      status: schema.status || 'candidate',
    }))
    .sort((left, right) => schemaKey(left).localeCompare(schemaKey(right)));
  const passageIds = new Set(facts.flatMap((fact) => normalizeList(fact.passageIds)));
  const passages = normalizeList(cellGraph.passages)
    .filter((passage) => passageIds.has(passage.passageId || passage.id))
    .sort((left, right) => String(left.passageId || left.id).localeCompare(String(right.passageId || right.id)));

  return {
    schemaVersion: GLOBAL_MEMORY_PROMOTION_SCHEMA_VERSION,
    cellId: cellGraph.cellId,
    supportThreshold: threshold,
    passages,
    schemas,
    facts,
  };
}
