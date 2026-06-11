import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_HARNESS_CONFIG } from '../src/harness-sidecar/config/configLoader.js';
import { chooseMemoryExtractionMode } from '../src/harness-sidecar/memory/modelAssistedExtractionPolicy.js';
import { runMemoryExtractionSociety } from '../src/harness-sidecar/memory/memoryExtractionSociety.js';

function configWithModelAssistedMemory(overrides = {}) {
  return {
    ...DEFAULT_HARNESS_CONFIG,
    productionCapabilities: {
      ...DEFAULT_HARNESS_CONFIG.productionCapabilities,
      modelAssistedMemory: {
        ...DEFAULT_HARNESS_CONFIG.productionCapabilities.modelAssistedMemory,
        ...overrides,
      },
    },
  };
}

test('memory extraction policy defaults to deterministic mode', () => {
  const decision = chooseMemoryExtractionMode({});

  assert.equal(decision.mode, 'deterministic');
  assert.equal(decision.reasons.includes('model_assisted_memory_disabled'), true);
  assert.deepEqual(decision.requiredGuards, []);
});

test('memory extraction society keeps model assistance disabled by the production gate', () => {
  let hookCalls = 0;

  const result = runMemoryExtractionSociety({
    config: configWithModelAssistedMemory({ enabled: false, mode: 'offline' }),
    observations: [{ text: 'A retrieved trace says memory stays deterministic.', source: 'trace-disabled' }],
    modelAssistance: { enabled: true },
    modelHooks: {
      extractFacts: () => {
        hookCalls += 1;
        return [{
          subject: 'memoryExtractionSociety',
          relation: 'uses',
          object: 'model output',
          passageIds: ['trace-disabled'],
        }];
      },
    },
  });

  assert.equal(hookCalls, 0);
  assert.equal(result.modelAssistance.mode, 'deterministic');
  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.hookTrace, []);
});

test('enabled model extraction is schema-validated provenance-bound and evidence-only', () => {
  const result = runMemoryExtractionSociety({
    config: configWithModelAssistedMemory({ enabled: true, mode: 'advisory', authority: 'evidence_only' }),
    caseContext: {
      retrievedProvenance: [{ id: 'retrieved-1' }],
    },
    observations: [{
      text: 'Retrieved passage says MemGraphRAG stores provenance-backed facts.',
      source: 'retrieved-1',
    }],
    modelAssistance: { enabled: true },
    roleHandlers: {
      passage_collector: () => [{
        passageId: 'model-extra-1',
        text: 'Model-visible extra passage includes token=ghp_should_not_leak.',
      }],
      schema_proposer: () => [{
        headType: 'system',
        relation: 'stores',
        tailType: 'memory_feature',
      }],
      fact_extractor: () => [
        {
          subject: 'MemGraphRAG',
          subjectType: 'system',
          relation: 'stores',
          object: 'provenance-backed facts',
          objectType: 'memory_feature',
          passageIds: ['retrieved-1'],
          confidence: 0.95,
          canPromote: true,
        },
        {
          subject: 'MemGraphRAG',
          subjectType: 'system',
          relation: 'promotes',
          object: 'unsupported model claims',
          objectType: 'risk',
          passageIds: ['invented-passage'],
          confidence: 0.99,
          promoted: true,
        },
        {
          relation: 'omits',
          object: 'required schema fields',
          passageIds: ['retrieved-1'],
        },
      ],
      merge_planner: ({ facts }) => [{
        action: 'merge_fact',
        factId: facts[0].id,
        reason: 'supported by retrieved provenance',
        promotionAllowed: true,
        durableWriteAllowed: true,
      }],
      evaluator: () => [{
        metric: 'modelVisibleSafety',
        value: 'token=ghp_should_not_leak',
        approved: true,
        canPromote: true,
        authority: 'admin',
      }],
    },
  });

  assert.equal(result.modelAssistance.mode, 'model_assisted');
  assert.equal(result.modelAssistance.policyGate.evidenceOnly, true);
  assert.equal(result.modelAssistance.policyGate.durableWriteAllowed, false);
  assert.equal(result.modelAssistance.policyGate.promotionAllowed, false);
  assert.equal(result.modelAssistance.requiredGuards.includes('retrieved_provenance_required'), true);

  assert.deepEqual(result.facts.map((fact) => fact.object), ['provenance-backed facts']);
  assert.deepEqual(result.rejectedFacts.map((fact) => fact.object), ['unsupported model claims']);
  assert.equal(result.rejectedFacts[0].guard.reasons.includes('missing_retrieved_provenance'), true);
  assert.equal(JSON.stringify(result.passages).includes('ghp_should_not_leak'), false);

  assert.equal(result.roleOutputs.fact_extractor[0].canPromote, false);
  assert.equal(result.roleOutputs.fact_extractor[1].promoted, false);
  assert.equal(result.mergePlan.actions[0].policyGate.durableWriteAllowed, false);
  assert.equal(result.mergePlan.actions[0].policyGate.promotionAllowed, false);
  assert.equal(result.evaluation.policyGate.durableWriteAllowed, false);
  assert.equal(result.evaluation.policyGate.promotionEvidenceOnly, true);

  assert.equal(result.roleOutputs.evaluator[0].approved, false);
  assert.equal(result.roleOutputs.evaluator[0].canPromote, false);
  assert.equal(result.roleOutputs.evaluator[0].authority, 'evidence_only');
  assert.equal(JSON.stringify(result.roleOutputs).includes('ghp_should_not_leak'), false);
  assert.equal(result.modelAssistance.quarantine.reasons.includes('authority_claim_removed'), true);
  assert.equal(result.modelAssistance.quarantine.reasons.includes('secret_like_value'), true);
});

test('model-assisted facts are rejected when no schema matches their type relation triple', () => {
  const result = runMemoryExtractionSociety({
    config: configWithModelAssistedMemory({ enabled: true, mode: 'advisory', authority: 'evidence_only' }),
    caseContext: {
      retrievedProvenance: [{ id: 'retrieved-schema-1' }],
    },
    observations: [{
      text: 'Retrieved passage says MemGraphRAG stores typed facts.',
      source: 'retrieved-schema-1',
    }],
    modelAssistance: { enabled: true },
    roleHandlers: {
      fact_extractor: () => [{
        subject: 'MemGraphRAG',
        subjectType: 'system',
        relation: 'stores',
        object: 'typed facts',
        objectType: 'memory_feature',
        passageIds: ['retrieved-schema-1'],
      }],
    },
  });

  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.rejectedFacts.map((fact) => fact.object), ['typed facts']);
  assert.equal(result.rejectedFacts[0].guard.reasons.includes('missing_schema_support'), true);
});

test('model-assisted facts require caller supplied provenance instead of self-cited model passages', () => {
  const selfCited = runMemoryExtractionSociety({
    config: configWithModelAssistedMemory({ enabled: true, mode: 'advisory', authority: 'evidence_only' }),
    caseContext: {
      operatorProvenance: [{ id: 'operator-passage-1' }],
    },
    observations: [{
      text: 'Operator passage does not contain the model invented claim.',
      source: 'operator-passage-1',
    }],
    modelAssistance: { enabled: true },
    roleHandlers: {
      passage_collector: () => [{
        passageId: 'model-invented-1',
        text: 'Model invented passage claims MemGraphRAG directly promotes memories.',
      }],
      schema_proposer: () => [{
        headType: 'system',
        relation: 'promotes',
        tailType: 'risk',
      }],
      fact_extractor: () => [{
        subject: 'MemGraphRAG',
        subjectType: 'system',
        relation: 'promotes',
        object: 'direct memory writes',
        objectType: 'risk',
        passageIds: ['model-invented-1'],
      }],
    },
  });

  const noProvenance = runMemoryExtractionSociety({
    config: configWithModelAssistedMemory({ enabled: true, mode: 'advisory', authority: 'evidence_only' }),
    observations: [{
      text: 'No retrieved or operator provenance context was supplied.',
      source: 'observation-only-1',
    }],
    modelAssistance: { enabled: true },
    roleHandlers: {
      schema_proposer: () => [{
        headType: 'system',
        relation: 'stores',
        tailType: 'memory_feature',
      }],
      fact_extractor: () => [{
        subject: 'MemGraphRAG',
        subjectType: 'system',
        relation: 'stores',
        object: 'observation-only facts',
        objectType: 'memory_feature',
        passageIds: ['observation-only-1'],
      }],
    },
  });

  assert.deepEqual(selfCited.facts, []);
  assert.deepEqual(selfCited.rejectedFacts.map((fact) => fact.object), ['direct memory writes']);
  assert.equal(selfCited.rejectedFacts[0].guard.reasons.includes('missing_retrieved_provenance'), true);

  assert.deepEqual(noProvenance.facts, []);
  assert.deepEqual(noProvenance.rejectedFacts.map((fact) => fact.object), ['observation-only facts']);
  assert.equal(noProvenance.rejectedFacts[0].guard.reasons.includes('missing_retrieved_provenance'), true);
});

test('model-created passages cannot alias caller provenance ids to self-ground facts', () => {
  const result = runMemoryExtractionSociety({
    config: configWithModelAssistedMemory({ enabled: true, mode: 'advisory', authority: 'evidence_only' }),
    caseContext: {
      retrievedProvenance: [{ id: 'retrieved-1' }],
    },
    observations: [],
    modelAssistance: { enabled: true },
    roleHandlers: {
      passage_collector: () => [{
        passageId: 'retrieved-1',
        text: 'Model-created passage reuses a retrieved provenance id.',
      }],
      schema_proposer: () => [{
        headType: 'system',
        relation: 'stores',
        tailType: 'memory_feature',
      }],
      fact_extractor: () => [{
        subject: 'MemGraphRAG',
        subjectType: 'system',
        relation: 'stores',
        object: 'aliased model-created support',
        objectType: 'memory_feature',
        passageIds: ['retrieved-1'],
      }],
    },
  });

  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.passages, []);
  assert.equal(result.roleOutputs.passage_collector, undefined);
  assert.deepEqual(result.rejectedFacts.map((fact) => fact.object), ['aliased model-created support']);
  assert.equal(result.rejectedFacts[0].guard.reasons.includes('missing_caller_provenance_support'), true);
  assert.equal(result.rejectedFacts[0].guard.reasons.includes('model_provenance_id_collision'), true);
  assert.deepEqual(result.rejectedFacts[0].guard.missingCallerSupportPassageIds, ['retrieved-1']);
  assert.deepEqual(result.rejectedFacts[0].guard.modelProvenanceIdCollisionIds, ['retrieved-1']);
});

test('model-created passage aliases are rejected across provenance identity fields', () => {
  for (const callerField of ['id', 'source', 'traceId', 'ref', 'provenanceId', 'provenanceRef']) {
    for (const modelField of ['id', 'source', 'traceId', 'ref', 'provenanceId', 'provenanceRef']) {
    const result = runMemoryExtractionSociety({
      config: configWithModelAssistedMemory({ enabled: true, mode: 'advisory', authority: 'evidence_only' }),
      caseContext: {
        retrievedProvenance: [{ [callerField]: 'retrieved-field-1' }],
      },
      observations: [],
      modelAssistance: { enabled: true },
      roleHandlers: {
        passage_collector: () => [{
          [modelField]: 'retrieved-field-1',
          passageId: `model-created-${callerField}-${modelField}`,
          text: 'Model-created passage reuses protected caller provenance metadata.',
        }],
        schema_proposer: () => [{
          headType: 'system',
          relation: 'stores',
          tailType: 'memory_feature',
        }],
        fact_extractor: () => [{
          subject: 'MemGraphRAG',
          subjectType: 'system',
          relation: 'stores',
          object: `aliased ${callerField} ${modelField}`,
          objectType: 'memory_feature',
          passageIds: ['retrieved-field-1'],
        }],
      },
    });

      const label = `${callerField}:${modelField}`;
      assert.deepEqual(result.passages, [], label);
      assert.equal(result.roleOutputs.passage_collector, undefined, label);
      assert.equal(result.rejectedFacts[0].guard.reasons.includes('model_provenance_id_collision'), true, label);
      assert.deepEqual(result.rejectedFacts[0].guard.modelProvenanceIdCollisionIds, ['retrieved-field-1'], label);
    }
  }
});

test('later advisory roles cannot mutate facts to bypass extraction guards', () => {
  const result = runMemoryExtractionSociety({
    config: configWithModelAssistedMemory({ enabled: true, mode: 'advisory', authority: 'evidence_only' }),
    caseContext: {
      retrievedProvenance: [{ id: 'retrieved-safe-1' }],
    },
    observations: [{
      text: 'Retrieved passage says MemGraphRAG stores guarded facts.',
      source: 'retrieved-safe-1',
    }],
    modelAssistance: { enabled: true },
    roleHandlers: {
      schema_proposer: () => [{
        headType: 'system',
        relation: 'stores',
        tailType: 'memory_feature',
      }],
      fact_extractor: () => [{
        subject: 'MemGraphRAG',
        subjectType: 'system',
        relation: 'stores',
        object: 'guarded facts',
        objectType: 'memory_feature',
        passageIds: ['retrieved-safe-1'],
      }],
      merge_planner: ({ facts }) => {
        facts.push({
          subject: 'InjectedModelFact',
          subjectType: 'system',
          relation: 'promotes',
          object: 'unguarded writes',
          objectType: 'risk',
          passageIds: ['missing-evidence'],
          canPromote: true,
        });
        return [];
      },
    },
  });

  assert.deepEqual(result.facts.map((fact) => fact.object), ['guarded facts']);
  assert.equal(JSON.stringify(result.facts).includes('unguarded writes'), false);
  assert.equal(JSON.stringify(result.facts).includes('canPromote'), false);
});

test('role handlers cannot mutate caller observation inputs', () => {
  const observations = [{
    text: 'Original operator observation.',
    source: 'operator-observation-1',
  }];

  runMemoryExtractionSociety({
    config: configWithModelAssistedMemory({ enabled: true, mode: 'advisory', authority: 'evidence_only' }),
    observations,
    modelAssistance: { enabled: true },
    roleHandlers: {
      passage_collector: ({ observations: exposedObservations }) => {
        exposedObservations[0].text = 'Mutated by role handler.';
        exposedObservations.push({ text: 'Injected observation.', source: 'injected-observation-1' });
        return [];
      },
    },
  });

  assert.deepEqual(observations, [{
    text: 'Original operator observation.',
    source: 'operator-observation-1',
  }]);
});

test('model-created passages cannot overwrite caller provenance content by reusing ids', () => {
  const result = runMemoryExtractionSociety({
    config: configWithModelAssistedMemory({ enabled: true, mode: 'advisory', authority: 'evidence_only' }),
    caseContext: {
      retrievedProvenance: [{ id: 'retrieved-1' }],
    },
    observations: [{
      text: 'Caller passage says MemGraphRAG stores harmless baseline facts.',
      source: 'retrieved-1',
    }],
    modelAssistance: { enabled: true },
    roleHandlers: {
      passage_collector: () => [{
        passageId: 'retrieved-1',
        text: 'Model overwrite says MemGraphRAG performs direct memory writes.',
      }],
      schema_proposer: () => [{
        headType: 'system',
        relation: 'performs',
        tailType: 'risk',
      }],
      fact_extractor: () => [{
        subject: 'MemGraphRAG',
        subjectType: 'system',
        relation: 'performs',
        object: 'direct memory writes',
        objectType: 'risk',
        passageIds: ['retrieved-1'],
      }],
    },
  });

  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.rejectedFacts.map((fact) => fact.object), ['direct memory writes']);
  assert.equal(result.rejectedFacts[0].guard.reasons.includes('model_provenance_id_collision'), true);
  assert.equal(result.passages[0].text, 'Caller passage says MemGraphRAG stores harmless baseline facts.');
});
