export const MEMORY_EXTRACTION_SOCIETY_SCHEMA_VERSION = 1;

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

function passageIdFor(observation = {}, index) {
  return observation.passageId
    || observation.source
    || observation.traceId
    || `observation_${String(index + 1).padStart(4, '0')}_${normalizeToken(observation.text)}`;
}

function factKey(fact = {}) {
  return [
    String(fact.subject || ''),
    String(fact.relation || fact.predicate || ''),
  ].join('\0');
}

function normalizeFact(observation = {}) {
  const relation = observation.relation || observation.predicate;
  if (!observation.subject || !relation || !observation.object) return null;
  return {
    subject: String(observation.subject),
    subjectType: observation.subjectType || observation.headType || 'entity',
    relation,
    predicate: relation,
    object: String(observation.object),
    objectType: observation.objectType || observation.tailType || 'entity',
    passageIds: normalizeList(observation.passageIds || observation.passageId || observation.source).map(String).sort(),
    confidence: Number.isFinite(Number(observation.confidence)) ? Number(observation.confidence) : null,
    status: observation.status || 'local_pending',
  };
}

function normalizePassage(passage = {}, index = 0) {
  const passageId = passageIdFor(passage, index);
  return {
    id: passage.id || passageId,
    passageId,
    text: passage.text || passage.summary || '',
    source: passage.source,
  };
}

function normalizeSchema(observation = {}) {
  const relation = observation.relation || observation.predicate;
  if (!relation || !observation.subjectType || !observation.objectType) return null;
  return {
    headType: observation.subjectType,
    relation,
    tailType: observation.objectType,
    frequency: Number.isFinite(Number(observation.frequency)) ? Number(observation.frequency) : 1,
    status: observation.status || 'candidate',
  };
}

function schemaKey(schema = {}) {
  return [schema.headType, schema.relation, schema.tailType].join('\0');
}

function fullFactKey(fact = {}) {
  return [fact.subject, fact.relation, fact.object].join('\0');
}

function upsertByIdentity(items, item, identity) {
  if (!item) return;
  const itemKey = identity(item);
  const index = items.findIndex((existing) => identity(existing) === itemKey);
  if (index === -1) {
    items.push(item);
    return;
  }
  items[index] = {
    ...items[index],
    ...item,
    passageIds: item.passageIds
      ? [...new Set([...normalizeList(items[index].passageIds), ...normalizeList(item.passageIds)])].sort()
      : items[index].passageIds,
  };
}

function callHook({ hook, name, context, hookTrace }) {
  if (typeof hook !== 'function') return [];
  const result = normalizeList(hook(context));
  if (result.length > 0) hookTrace.push(name);
  return result;
}

function findContradictions(facts = []) {
  const bySlot = new Map();
  const contradictions = [];
  for (const fact of facts) {
    const key = factKey(fact);
    const existing = bySlot.get(key);
    if (existing && existing.object !== fact.object) {
      contradictions.push({
        type: 'duplicate_subject_relation_different_object',
        subject: fact.subject,
        relation: fact.relation,
        objects: [existing.object, fact.object].sort(),
        passageIds: [...new Set([...normalizeList(existing.passageIds), ...normalizeList(fact.passageIds)])].sort(),
      });
    }
    if (!existing) bySlot.set(key, fact);
  }
  return contradictions.sort((left, right) => (
    left.subject.localeCompare(right.subject)
    || left.relation.localeCompare(right.relation)
    || left.objects.join('\0').localeCompare(right.objects.join('\0'))
  ));
}

export function runMemoryExtractionSociety({
  observations = [],
  modelAssistance = {},
  modelHooks = {},
} = {}) {
  const passages = [];
  const schemas = [];
  const facts = [];
  const hookTrace = [];
  const normalizedObservations = normalizeList(observations);

  normalizedObservations.forEach((observation, index) => {
    if (observation.text || observation.source || observation.passageId) {
      upsertByIdentity(passages, normalizePassage(observation, index), (passage) => passage.passageId);
    }

    const schema = normalizeSchema(observation);
    if (schema) upsertByIdentity(schemas, schema, schemaKey);

    const fact = normalizeFact(observation);
    if (fact) upsertByIdentity(facts, fact, fullFactKey);
  });

  if (modelAssistance.enabled === true) {
    const context = {
      observations: normalizedObservations,
      passages: passages.map((passage) => ({ ...passage })),
      schemas: schemas.map((schema) => ({ ...schema })),
      facts: facts.map((fact) => ({ ...fact })),
    };
    callHook({ hook: modelHooks.extractPassages, name: 'extractPassages', context, hookTrace })
      .forEach((passage, index) => upsertByIdentity(passages, normalizePassage(passage, index), (item) => item.passageId));
    callHook({ hook: modelHooks.induceSchemas, name: 'induceSchemas', context, hookTrace })
      .map(normalizeSchema)
      .forEach((schema) => upsertByIdentity(schemas, schema, schemaKey));
    callHook({ hook: modelHooks.extractFacts, name: 'extractFacts', context, hookTrace })
      .map(normalizeFact)
      .forEach((fact) => upsertByIdentity(facts, fact, fullFactKey));
  }

  const hookContradictions = modelAssistance.enabled === true
    ? callHook({
      hook: modelHooks.checkContradictions,
      name: 'checkContradictions',
      context: {
        observations: normalizedObservations,
        passages,
        schemas,
        facts,
      },
      hookTrace,
    })
    : [];

  return {
    schemaVersion: MEMORY_EXTRACTION_SOCIETY_SCHEMA_VERSION,
    roles: ['passage_extractor', 'schema_inducer', 'fact_extractor', 'contradiction_checker'],
    passages: passages.sort((left, right) => left.passageId.localeCompare(right.passageId)),
    schemas: schemas.sort((left, right) => (
      left.headType.localeCompare(right.headType)
      || left.relation.localeCompare(right.relation)
      || left.tailType.localeCompare(right.tailType)
    )),
    facts: facts.sort((left, right) => (
      left.subject.localeCompare(right.subject)
      || left.relation.localeCompare(right.relation)
      || left.object.localeCompare(right.object)
    )),
    contradictions: [...findContradictions(facts), ...hookContradictions],
    hookTrace: hookTrace.sort(),
  };
}
