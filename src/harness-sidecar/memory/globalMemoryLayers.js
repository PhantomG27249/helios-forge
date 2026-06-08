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

export function schemaIdFor(schema = {}) {
  return [
    'schema',
    normalizeToken(schema.headType),
    normalizeToken(schema.relation),
    normalizeToken(schema.tailType),
  ].join('_');
}

export function factIdFor(fact = {}) {
  const passagePart = uniqueSorted(fact.passageIds || fact.provenancePassageIds || fact.passageId)
    .join('_') || 'no_passage';
  return [
    'fact',
    normalizeToken(fact.subject),
    normalizeToken(fact.relation || fact.predicate),
    normalizeToken(fact.object),
    normalizeToken(passagePart),
  ].join('_');
}

function normalizeSchema(schema = {}) {
  const normalized = {
    ...schema,
    headType: schema.headType || schema.subjectType || 'entity',
    relation: schema.relation || schema.predicate || 'related_to',
    tailType: schema.tailType || schema.objectType || 'entity',
  };
  return {
    ...normalized,
    id: schema.id || schemaIdFor(normalized),
    frequency: Number.isFinite(Number(schema.frequency)) ? Number(schema.frequency) : 1,
    status: schema.status || 'candidate',
  };
}

function normalizePassage(passage = {}) {
  const passageId = passage.passageId || passage.id || `passage_${normalizeToken(passage.path || passage.source || passage.artifactId || passage.text)}`;
  return {
    ...passage,
    id: passageId,
    passageId,
    text: passage.text || passage.summary || '',
  };
}

function normalizeFact(fact = {}) {
  const relation = fact.relation || fact.predicate || 'related_to';
  const passageIds = uniqueSorted(fact.passageIds || fact.provenancePassageIds || fact.passageId);
  const normalized = {
    ...fact,
    subject: String(fact.subject || ''),
    subjectType: fact.subjectType || fact.headType || 'entity',
    relation,
    predicate: relation,
    object: String(fact.object || ''),
    objectType: fact.objectType || fact.tailType || 'entity',
    passageIds,
  };
  const schemaId = fact.schemaId || schemaIdFor({
    headType: normalized.subjectType,
    relation: normalized.relation,
    tailType: normalized.objectType,
  });
  return {
    ...normalized,
    id: fact.id || factIdFor(normalized),
    schemaId,
    status: fact.status || 'pending',
    confidence: Number.isFinite(Number(fact.confidence)) ? Number(fact.confidence) : null,
  };
}

export function createGlobalMemoryLayers({
  schemas = [],
  facts = [],
  passages = [],
} = {}) {
  const layers = { schemas: [], facts: [], passages: [] };
  for (const passage of normalizeList(passages)) upsertPassage(layers, passage);
  for (const schema of normalizeList(schemas)) upsertSchema(layers, schema);
  for (const fact of normalizeList(facts)) upsertFact(layers, fact);
  return layers;
}

export function upsertSchema(layers, schema) {
  if (!layers) throw new Error('layers is required');
  if (!Array.isArray(layers.schemas)) layers.schemas = [];
  const normalized = normalizeSchema(schema);
  const index = layers.schemas.findIndex((item) => item.id === normalized.id);
  if (index === -1) {
    layers.schemas.push(normalized);
    layers.schemas.sort((left, right) => left.id.localeCompare(right.id));
    return normalized;
  }
  const existing = layers.schemas[index];
  const nextFrequency = Number.isFinite(Number(schema.frequency))
    ? Math.max(existing.frequency || 1, Number(schema.frequency))
    : (existing.frequency || 1) + 1;
  const merged = {
    ...existing,
    ...normalized,
    frequency: nextFrequency,
    status: existing.status === 'stable' || normalized.status === 'stable' ? 'stable' : normalized.status,
  };
  layers.schemas[index] = merged;
  return merged;
}

export function upsertPassage(layers, passage) {
  if (!layers) throw new Error('layers is required');
  if (!Array.isArray(layers.passages)) layers.passages = [];
  const normalized = normalizePassage(passage);
  const index = layers.passages.findIndex((item) => item.passageId === normalized.passageId);
  if (index === -1) {
    layers.passages.push(normalized);
    layers.passages.sort((left, right) => left.passageId.localeCompare(right.passageId));
    return normalized;
  }
  const merged = { ...layers.passages[index], ...normalized };
  layers.passages[index] = merged;
  return merged;
}

export function upsertFact(layers, fact) {
  if (!layers) throw new Error('layers is required');
  if (!Array.isArray(layers.facts)) layers.facts = [];
  const normalized = normalizeFact(fact);
  const index = layers.facts.findIndex((item) => item.id === normalized.id);
  if (index === -1) {
    layers.facts.push(normalized);
    layers.facts.sort((left, right) => left.id.localeCompare(right.id));
    return normalized;
  }
  const merged = {
    ...layers.facts[index],
    ...normalized,
    passageIds: uniqueSorted([...normalizeList(layers.facts[index].passageIds), ...normalized.passageIds]),
  };
  layers.facts[index] = merged;
  return merged;
}

export function activateStableSchemas({ layers, schemaThreshold = 2 } = {}) {
  if (!layers) throw new Error('layers is required');
  const threshold = Math.max(1, Number.isFinite(Number(schemaThreshold)) ? Number(schemaThreshold) : 2);
  const stableSchemaIds = [];
  const activatedFactIds = [];

  for (const schema of normalizeList(layers.schemas)) {
    if ((schema.frequency || 0) >= threshold) {
      schema.status = 'stable';
      stableSchemaIds.push(schema.id);
    }
  }

  const stableSet = new Set(stableSchemaIds);
  for (const fact of normalizeList(layers.facts)) {
    if (stableSet.has(fact.schemaId) && fact.status !== 'discarded' && fact.status !== 'quarantined') {
      if (fact.status !== 'active') activatedFactIds.push(fact.id);
      fact.status = 'active';
    }
  }

  return {
    stableSchemaIds: stableSchemaIds.sort(),
    activatedFactIds: activatedFactIds.sort(),
  };
}

