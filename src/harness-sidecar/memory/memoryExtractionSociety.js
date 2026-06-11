import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';
import { chooseMemoryExtractionMode } from './modelAssistedExtractionPolicy.js';

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

function factPassageSupport(fact = {}, passages = [], options = {}) {
  const passageIds = normalizeList(fact.passageIds).map(String);
  const available = new Set(passages.map((passage) => String(passage.passageId || passage.id)));
  const missing = passageIds.filter((passageId) => !available.has(passageId));
  const allowedProvenance = options.allowedProvenance;
  const requireAllowedProvenance = options.requireAllowedProvenance === true;
  const callerSupportPassageIds = options.callerSupportPassageIds;
  const requireCallerSupport = options.requireCallerSupport === true;
  const modelProvenanceIdCollisions = options.modelProvenanceIdCollisions;
  const missingRetrieved = allowedProvenance?.size
    ? passageIds.filter((passageId) => !allowedProvenance.has(passageId))
    : (requireAllowedProvenance ? passageIds : []);
  const missingCallerSupport = requireCallerSupport
    ? (
      callerSupportPassageIds?.size
        ? passageIds.filter((passageId) => !callerSupportPassageIds.has(passageId))
        : passageIds
    )
    : [];
  const collisionIds = modelProvenanceIdCollisions?.size
    ? passageIds.filter((passageId) => modelProvenanceIdCollisions.has(passageId))
    : [];
  const reasons = [];
  if (passageIds.length === 0 || missing.length > 0) reasons.push('missing_passage_support');
  if (requireAllowedProvenance && (!allowedProvenance?.size || passageIds.length === 0)) {
    reasons.push('missing_retrieved_provenance');
  } else if (missingRetrieved.length > 0) {
    reasons.push('missing_retrieved_provenance');
  }
  if (requireCallerSupport && (!callerSupportPassageIds?.size || passageIds.length === 0)) {
    reasons.push('missing_caller_provenance_support');
  } else if (missingCallerSupport.length > 0) {
    reasons.push('missing_caller_provenance_support');
  }
  if (collisionIds.length > 0) reasons.push('model_provenance_id_collision');
  return {
    supported: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    missingPassageIds: missing.sort(),
    missingRetrievedProvenanceIds: missingRetrieved.sort(),
    missingCallerSupportPassageIds: missingCallerSupport.sort(),
    modelProvenanceIdCollisionIds: collisionIds.sort(),
  };
}

function factSchemaSupport(fact = {}, schemas = [], options = {}) {
  if (options.requireSchema !== true) {
    return { supported: true, reasons: [] };
  }
  const supported = schemas.some((schema) => (
    schema.headType === fact.subjectType
    && schema.relation === fact.relation
    && schema.tailType === fact.objectType
  ));
  return {
    supported,
    reasons: supported ? [] : ['missing_schema_support'],
  };
}

function combineFactGuards(...guards) {
  const reasons = new Set();
  const missingPassageIds = [];
  const missingRetrievedProvenanceIds = [];
  const missingCallerSupportPassageIds = [];
  const modelProvenanceIdCollisionIds = [];
  for (const guard of guards) {
    normalizeList(guard?.reasons).forEach((reason) => reasons.add(reason));
    missingPassageIds.push(...normalizeList(guard?.missingPassageIds));
    missingRetrievedProvenanceIds.push(...normalizeList(guard?.missingRetrievedProvenanceIds));
    missingCallerSupportPassageIds.push(...normalizeList(guard?.missingCallerSupportPassageIds));
    modelProvenanceIdCollisionIds.push(...normalizeList(guard?.modelProvenanceIdCollisionIds));
  }
  return {
    supported: guards.every((guard) => guard?.supported === true),
    reasons: [...reasons].sort(),
    missingPassageIds: [...new Set(missingPassageIds.map(String))].sort(),
    missingRetrievedProvenanceIds: [...new Set(missingRetrievedProvenanceIds.map(String))].sort(),
    missingCallerSupportPassageIds: [...new Set(missingCallerSupportPassageIds.map(String))].sort(),
    modelProvenanceIdCollisionIds: [...new Set(modelProvenanceIdCollisionIds.map(String))].sort(),
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

function cloneForRole(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function callRole({ roleHandlers = {}, role, fallbackHook, fallbackName, context, roleTrace, hookTrace }) {
  const hook = roleHandlers[role] || fallbackHook;
  if (typeof hook !== 'function') return [];
  const result = normalizeList(hook(cloneForRole(context)));
  if (result.length > 0) {
    roleTrace.push(role);
    if (fallbackName && hook === fallbackHook) hookTrace.push(fallbackName);
  }
  return result;
}

function provenanceIdsFor(value = {}) {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || Array.isArray(value)) return [];
  return [
    value.id,
    value.passageId,
    value.source,
    value.traceId,
    value.ref,
    value.provenanceId,
    value.provenanceRef,
  ].filter(Boolean).map(String);
}

function provenanceSetFromContext(caseContext = {}, passages = []) {
  const configured = [
    ...normalizeList(caseContext.retrievedProvenance),
    ...normalizeList(caseContext.retrievedProvenanceRefs),
    ...normalizeList(caseContext.retrievedPassages),
    ...normalizeList(caseContext.operatorProvenance),
    ...normalizeList(caseContext.operatorProvenanceRefs),
    ...normalizeList(caseContext.provenanceRefs),
  ].flatMap(provenanceIdsFor).filter(Boolean).map(String);

  if (configured.length > 0) return new Set(configured);
  return null;
}

function passageIdSet(passages = []) {
  return new Set(normalizeList(passages)
    .map((passage) => passage.passageId || passage.id)
    .filter(Boolean)
    .map(String));
}

function createQuarantineTracker() {
  const reasons = new Set();
  let quarantined = false;
  let redacted = false;
  return {
    sanitize(value) {
      const result = quarantineModelVisiblePayload(value);
      quarantined = quarantined || result.quarantined;
      redacted = redacted || result.redacted;
      result.reasons.forEach((reason) => reasons.add(reason));
      return result.value;
    },
    summary() {
      return {
        quarantined,
        redacted,
        reasons: [...reasons].sort(),
      };
    },
  };
}

function modelAssistanceStatus(decision, quarantine) {
  return {
    mode: decision.mode,
    reasons: decision.reasons,
    requiredGuards: decision.requiredGuards,
    policyGate: {
      advisoryOnly: true,
      authority: 'evidence_only',
      evidenceOnly: true,
      durableWriteAllowed: false,
      promotionAllowed: false,
    },
    quarantine: quarantine.summary(),
  };
}

function shouldRunModelAssistance({ config, modelAssistance, decision }) {
  if (modelAssistance.enabled !== true) return false;
  if (config) return decision.mode === 'model_assisted';
  return true;
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
  config,
  caseContext = {},
  budget = {},
  risk = {},
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
  const decision = config
    ? chooseMemoryExtractionMode({ config, caseContext, budget, risk })
    : {
      mode: modelAssistance.enabled === true ? 'model_assisted' : 'deterministic',
      reasons: modelAssistance.enabled === true ? ['explicit_model_assistance_enabled'] : ['model_assisted_memory_disabled'],
      requiredGuards: modelAssistance.enabled === true
        ? [
          'schema_validation',
          'retrieved_provenance_required',
          'model_visible_quarantine',
          'evidence_only_authority',
          'no_direct_memory_promotion',
          'fallback_to_observation_provenance',
        ]
        : [],
    };
  const modelEnabled = shouldRunModelAssistance({ config, modelAssistance, decision });
  const quarantine = createQuarantineTracker();

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
  const callerSupportPassageIds = passageIdSet(passages);
  const callerProvenanceIds = provenanceSetFromContext(caseContext, passages) || new Set();
  const modelProvenanceIdCollisions = new Set();

  if (modelEnabled) {
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
    const guardedCollectedPassages = quarantine.sanitize(collectedPassages);
    const acceptedCollectedPassages = [];
    guardedCollectedPassages.forEach((passage, index) => {
        const normalizedPassage = normalizePassage(passage, index);
        const candidateIds = [
          ...provenanceIdsFor(passage),
          ...provenanceIdsFor(normalizedPassage),
          String(normalizedPassage.passageId),
        ].filter(Boolean);
        const collisionIds = [...new Set(candidateIds.filter((candidateId) => (
          callerSupportPassageIds.has(candidateId) || callerProvenanceIds.has(candidateId)
        )))];
        if (
          config
          && collisionIds.length > 0
        ) {
          collisionIds.forEach((collisionId) => modelProvenanceIdCollisions.add(collisionId));
          return;
        }
        acceptedCollectedPassages.push(normalizedPassage);
        upsertByIdentity(passages, normalizedPassage, (item) => item.passageId);
      });
    if (acceptedCollectedPassages.length > 0) roleOutputs.passage_collector = acceptedCollectedPassages;

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
    const guardedProposedSchemas = quarantine.sanitize(proposedSchemas);
    if (guardedProposedSchemas.length > 0) roleOutputs.schema_proposer = guardedProposedSchemas;
    guardedProposedSchemas
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
    const guardedExtractedFacts = quarantine.sanitize(extractedFacts);
    const allowedProvenance = provenanceSetFromContext(caseContext, passages);
    const requireProductionModelGuards = Boolean(config);
    if (guardedExtractedFacts.length > 0) roleOutputs.fact_extractor = guardedExtractedFacts;
    guardedExtractedFacts
      .map(normalizeFact)
      .forEach((fact) => {
        if (!fact) return;
        const guard = combineFactGuards(
          factPassageSupport(fact, passages, {
            allowedProvenance,
            requireAllowedProvenance: requireProductionModelGuards,
            callerSupportPassageIds,
            requireCallerSupport: requireProductionModelGuards,
            modelProvenanceIdCollisions,
          }),
          factSchemaSupport(fact, schemas, { requireSchema: requireProductionModelGuards }),
        );
        if (guard.supported) {
          upsertByIdentity(facts, fact, fullFactKey);
          return;
        }
        rejectedFacts.push({ ...fact, guard });
      });
  }

  const hookContradictions = modelEnabled
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
  const guardedHookContradictions = quarantine.sanitize(hookContradictions);
  if (guardedHookContradictions.length > 0) roleOutputs.contradiction_critic = guardedHookContradictions;

  if (modelEnabled) {
    const settledContext = {
      observations: normalizedObservations,
      passages,
      schemas,
      facts,
      rejectedFacts,
      contradictions: [...findContradictions(facts), ...guardedHookContradictions],
    };
    for (const role of ['merge_planner', 'graph_constructor', 'retriever', 'evaluator']) {
      const output = callRole({
        roleHandlers,
        role,
        context: settledContext,
        roleTrace,
        hookTrace,
      });
      const guardedOutput = quarantine.sanitize(output);
      if (guardedOutput.length > 0) roleOutputs[role] = guardedOutput;
    }
  }

  const contradictions = [...findContradictions(facts), ...guardedHookContradictions];
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
    modelAssistance: modelAssistanceStatus(decision, quarantine),
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
