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

export function runMemoryExtractionSociety({ observations = [] } = {}) {
  const passages = [];
  const schemas = [];
  const facts = [];

  normalizeList(observations).forEach((observation, index) => {
    if (observation.text || observation.source || observation.passageId) {
      const passageId = passageIdFor(observation, index);
      passages.push({
        id: passageId,
        passageId,
        text: observation.text || observation.summary || '',
        source: observation.source,
      });
    }

    const schema = normalizeSchema(observation);
    if (schema) schemas.push(schema);

    const fact = normalizeFact(observation);
    if (fact) facts.push(fact);
  });

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
    contradictions: findContradictions(facts),
  };
}
