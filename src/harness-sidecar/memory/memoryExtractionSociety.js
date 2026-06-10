export const MEMORY_EXTRACTION_SOCIETY_SCHEMA_VERSION = 1;
export const MEMORY_EXTRACTION_ROLES = [
  'passage_collector',
  'schema_proposer',
  'fact_extractor',
  'contradiction_critic',
  'merge_planner',
  'graph_constructor',
  'retriever',
  'evaluator',
];

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

function factPassageSupport(fact = {}, passages = []) {
  const passageIds = normalizeList(fact.passageIds).map(String);
  const available = new Set(passages.map((passage) => String(passage.passageId || passage.id)));
  const missing = passageIds.filter((passageId) => !available.has(passageId));
  const reasons = [];
  if (passageIds.length === 0 || missing.length > 0) reasons.push('missing_passage_support');
  return {
    supported: reasons.length === 0,
    reasons,
    missingPassageIds: missing.sort(),
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

function callRole({ roleHandlers = {}, role, fallbackHook, fallbackName, context, roleTrace, hookTrace }) {
  const hook = roleHandlers[role] || fallbackHook;
  if (typeof hook !== 'function') return [];
  const result = normalizeList(hook(context));
  if (result.length > 0) {
    roleTrace.push(role);
    if (fallbackName && hook === fallbackHook) hookTrace.push(fallbackName);
  }
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
  roleHandlers = {},
} = {}) {
  const passages = [];
  const schemas = [];
  const facts = [];
  const rejectedFacts = [];
  const hookTrace = [];
  const roleTrace = [];
  const roleOutputs = {};
  const normalizedObservations = normalizeList(observations);

  normalizedObservations.forEach((observation, index) => {
    if (observation.text || observation.source || observation.passageId) {
      upsertByIdentity(passages, normalizePassage(observation, index), (passage) => passage.passageId);
    }

    const schema = normalizeSchema(observation);
    if (schema) upsertByIdentity(schemas, schema, schemaKey);

    const fact = normalizeFact(observation);
    if (fact) {
      const guard = factPassageSupport(fact, passages);
      if (guard.supported) {
        upsertByIdentity(facts, fact, fullFactKey);
      } else {
        rejectedFacts.push({ ...fact, guard });
      }
    }
  });

  if (modelAssistance.enabled === true) {
    const context = {
      observations: normalizedObservations,
      passages: passages.map((passage) => ({ ...passage })),
      schemas: schemas.map((schema) => ({ ...schema })),
      facts: facts.map((fact) => ({ ...fact })),
    };
    const collectedPassages = callRole({
      roleHandlers,
      role: 'passage_collector',
      fallbackHook: modelHooks.extractPassages,
      fallbackName: 'extractPassages',
      context,
      roleTrace,
      hookTrace,
    });
    if (collectedPassages.length > 0) roleOutputs.passage_collector = collectedPassages;
    collectedPassages
      .forEach((passage, index) => upsertByIdentity(passages, normalizePassage(passage, index), (item) => item.passageId));

    const schemaContext = { ...context, passages: passages.map((passage) => ({ ...passage })) };
    const proposedSchemas = callRole({
      roleHandlers,
      role: 'schema_proposer',
      fallbackHook: modelHooks.induceSchemas,
      fallbackName: 'induceSchemas',
      context: schemaContext,
      roleTrace,
      hookTrace,
    });
    if (proposedSchemas.length > 0) roleOutputs.schema_proposer = proposedSchemas;
    proposedSchemas
      .map(normalizeSchema)
      .forEach((schema) => upsertByIdentity(schemas, schema, schemaKey));

    const factContext = {
      ...schemaContext,
      schemas: schemas.map((schema) => ({ ...schema })),
      facts: facts.map((fact) => ({ ...fact })),
    };
    const extractedFacts = callRole({
      roleHandlers,
      role: 'fact_extractor',
      fallbackHook: modelHooks.extractFacts,
      fallbackName: 'extractFacts',
      context: factContext,
      roleTrace,
      hookTrace,
    });
    if (extractedFacts.length > 0) roleOutputs.fact_extractor = extractedFacts;
    extractedFacts
      .map(normalizeFact)
      .forEach((fact) => {
        if (!fact) return;
        const guard = factPassageSupport(fact, passages);
        if (guard.supported) {
          upsertByIdentity(facts, fact, fullFactKey);
          return;
        }
        rejectedFacts.push({ ...fact, guard });
      });
  }

  const hookContradictions = modelAssistance.enabled === true
    ? callRole({
      roleHandlers,
      role: 'contradiction_critic',
      fallbackHook: modelHooks.checkContradictions,
      fallbackName: 'checkContradictions',
      context: {
        observations: normalizedObservations,
        passages,
        schemas,
        facts,
      },
      roleTrace,
      hookTrace,
    })
    : [];
  if (hookContradictions.length > 0) roleOutputs.contradiction_critic = hookContradictions;

  if (modelAssistance.enabled === true) {
    const settledContext = {
      observations: normalizedObservations,
      passages,
      schemas,
      facts,
      rejectedFacts,
      contradictions: [...findContradictions(facts), ...hookContradictions],
    };
    for (const role of ['merge_planner', 'graph_constructor', 'retriever', 'evaluator']) {
      const output = callRole({
        roleHandlers,
        role,
        context: settledContext,
        roleTrace,
        hookTrace,
      });
      if (output.length > 0) roleOutputs[role] = output;
    }
  }

  return {
    schemaVersion: MEMORY_EXTRACTION_SOCIETY_SCHEMA_VERSION,
    roles: MEMORY_EXTRACTION_ROLES,
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
    roleTrace: [...new Set(roleTrace)].sort(),
    roleOutputs,
    rejectedFacts: rejectedFacts.sort((left, right) => (
      left.subject.localeCompare(right.subject)
      || left.relation.localeCompare(right.relation)
      || left.object.localeCompare(right.object)
    )),
  };
}
