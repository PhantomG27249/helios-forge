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

function factIdFor(fact = {}) {
  const passagePart = normalizeList(fact.passageIds).map(normalizeToken).sort().join('_') || 'no_passage';
  return [
    'fact',
    normalizeToken(fact.subject),
    normalizeToken(fact.relation),
    normalizeToken(fact.object),
    passagePart,
  ].join('_');
}

function normalizeFact(observation = {}) {
  const relation = observation.relation || observation.predicate;
  if (!observation.subject || !relation || !observation.object) return null;
  const fact = {
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
  return {
    ...fact,
    id: observation.id || factIdFor(fact),
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
  const headType = observation.subjectType || observation.headType;
  const tailType = observation.objectType || observation.tailType;
  if (!relation || !headType || !tailType) return null;
  return {
    headType,
    relation,
    tailType,
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

function availableProvenance(passages = [], facts = []) {
  return new Set([
    ...normalizeList(passages).map((passage) => String(passage.passageId || passage.id)),
    ...normalizeList(facts).flatMap((fact) => normalizeList(fact.passageIds).map(String)),
  ]);
}

function normalizeMergePlan({ outputs = [], facts = [] } = {}) {
  const factsById = new Map(normalizeList(facts).map((fact) => [fact.id, fact]));
  return {
    advisoryOnly: true,
    actions: normalizeList(outputs).map((output, index) => {
      const factId = output.factId || output.targetFactId || output.id || null;
      const supported = factId ? factsById.has(factId) : false;
      const reasons = [...new Set([
        ...normalizeList(output.reasons || output.reason),
        ...(supported ? [] : ['advisory_target_not_supported']),
      ].map(String))].sort();

      return {
        id: output.id || `merge_action_${String(index + 1).padStart(3, '0')}`,
        action: output.action || 'advise',
        factId,
        reason: output.reason,
        reasons,
        policyGate: {
          status: supported ? 'evidence_backed' : 'needs_review',
          durableWriteAllowed: false,
          promotionAllowed: false,
          reasons: supported ? ['advisory_merge_requires_policy_runtime'] : reasons,
        },
      };
    }),
  };
}

function normalizeGraphPlan({ outputs = [], facts = [] } = {}) {
  const provenanceIds = [...new Set(normalizeList(facts)
    .flatMap((fact) => normalizeList(fact.passageIds).map(String)))].sort();
  return {
    advisoryOnly: true,
    provenanceIds,
    candidateNodes: normalizeList(outputs).flatMap((output) => normalizeList(output.nodes)),
    candidateEdges: normalizeList(outputs).flatMap((output) => normalizeList(output.edges)),
  };
}

function normalizeRetrievalPlan({ outputs = [], passages = [], facts = [] } = {}) {
  const available = availableProvenance(passages, facts);
  return {
    advisoryOnly: true,
    items: normalizeList(outputs).map((output, index) => {
      const requested = normalizeList(output.provenanceIds || output.passageIds || output.provenance)
        .map(String)
        .sort();
      return {
        id: output.id || `retrieval_item_${String(index + 1).padStart(3, '0')}`,
        query: output.query || '',
        provenanceIds: requested.filter((id) => available.has(id)),
        missingProvenanceIds: requested.filter((id) => !available.has(id)),
        reasons: normalizeList(output.reasons || output.reason).map(String).sort(),
      };
    }),
  };
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
}

function normalizeEvaluation({
  outputs = [],
  facts = [],
  rejectedFacts = [],
  contradictions = [],
  roleTrace = [],
} = {}) {
  const supportedFactCount = normalizeList(facts).length;
  const rejectedFactCount = normalizeList(rejectedFacts).length;
  const contradictionCount = normalizeList(contradictions).length;
  return {
    advisoryOnly: true,
    signals: normalizeList(outputs),
    metrics: {
      supportedFactCount,
      rejectedFactCount,
      contradictionCount,
      advisoryRoleCount: new Set(roleTrace).size,
      passageSupportRate: ratio(supportedFactCount, supportedFactCount + rejectedFactCount),
    },
    policyGate: {
      durableWriteAllowed: false,
      promotionEvidenceOnly: true,
      status: contradictionCount === 0 && rejectedFactCount === 0 ? 'clean_advisory_evidence' : 'needs_review',
    },
  };
}

function buildRoleAudit(roleOutputs = {}) {
  return MEMORY_EXTRACTION_ROLES
    .filter((role) => Object.hasOwn(roleOutputs, role))
    .map((role) => ({
      role,
      authority: 'advisory',
      outputCount: normalizeList(roleOutputs[role]).length,
    }));
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

  const contradictions = [...findContradictions(facts), ...hookContradictions];
  const mergePlan = normalizeMergePlan({ outputs: roleOutputs.merge_planner, facts });
  const graphPlan = normalizeGraphPlan({ outputs: roleOutputs.graph_constructor, facts });
  const retrievalPlan = normalizeRetrievalPlan({ outputs: roleOutputs.retriever, passages, facts });
  const evaluation = normalizeEvaluation({
    outputs: roleOutputs.evaluator,
    facts,
    rejectedFacts,
    contradictions,
    roleTrace,
  });

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
    contradictions,
    hookTrace: hookTrace.sort(),
    roleTrace: [...new Set(roleTrace)].sort(),
    roleAudit: buildRoleAudit(roleOutputs),
    roleOutputs,
    mergePlan,
    graphPlan,
    retrievalPlan,
    evaluation,
    rejectedFacts: rejectedFacts.sort((left, right) => (
      left.subject.localeCompare(right.subject)
      || left.relation.localeCompare(right.relation)
      || left.object.localeCompare(right.object)
    )),
  };
}
