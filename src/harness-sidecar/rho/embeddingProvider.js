import {
  deterministicFallbackEmbedding,
  normalizeEmbedding,
} from './coresetBuilder.js';

const DEFAULT_FALLBACK_DIMENSIONS = 16;

function stableString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function normalizeGate(options = {}) {
  return (
    options.productionCapabilities?.modelBackedRhoEmbeddings ??
    options.config?.productionCapabilities?.modelBackedRhoEmbeddings ??
    options.modelProvider?.productionCapabilities?.modelBackedRhoEmbeddings ??
    { enabled: false, mode: 'offline', authority: 'evidence_only' }
  );
}

function modelBackedEmbeddingsEnabled(gate) {
  return gate?.enabled === true &&
    gate?.mode !== 'offline' &&
    (gate?.authority === undefined || gate.authority === 'evidence_only');
}

function textInputId(input, index) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return stableString(input.id ?? input.caseId ?? input.taskId ?? `embedding_${index + 1}`);
  }
  return `embedding_${index + 1}`;
}

function textInputText(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return stableString(input.text ?? input.prompt ?? input.summary ?? input.description ?? input.content);
  }
  return stableString(input);
}

function normalizeTextInputs(inputs = []) {
  return (Array.isArray(inputs) ? inputs : [inputs]).map((input, index) => ({
    ...(
      input && typeof input === 'object' && !Array.isArray(input)
        ? input
        : {}
    ),
    id: textInputId(input, index),
    text: textInputText(input),
  }));
}

function caseText(rhoCase = {}) {
  const fields = [
    rhoCase.text,
    rhoCase.prompt,
    rhoCase.summary,
    rhoCase.description,
    rhoCase.domain,
    rhoCase.kind,
    rhoCase.status,
    ...(Array.isArray(rhoCase.failureModes) ? rhoCase.failureModes : []),
    ...(Array.isArray(rhoCase.reasons) ? rhoCase.reasons : []),
    ...(Array.isArray(rhoCase.tags) ? rhoCase.tags : []),
  ];
  return fields.map(stableString).filter(Boolean).join(' ');
}

function normalizeCaseInputs(cases = []) {
  return (Array.isArray(cases) ? cases : [cases]).map((rhoCase, index) => ({
    ...rhoCase,
    id: stableString(rhoCase?.id ?? rhoCase?.caseId ?? rhoCase?.taskId ?? `case_${index + 1}`),
    text: caseText(rhoCase),
  }));
}

function fallbackDimensions(fallback) {
  return Math.max(0, Math.floor(Number(
    fallback?.dimensions ?? fallback?.fallbackEmbeddingDimensions ?? DEFAULT_FALLBACK_DIMENSIONS,
  ) || 0));
}

async function callModelProvider(modelProvider, inputs) {
  if (!modelProvider) {
    return [];
  }
  if (typeof modelProvider.embedTextBatch === 'function') {
    return modelProvider.embedTextBatch(inputs);
  }
  if (typeof modelProvider.embedBatch === 'function') {
    return modelProvider.embedBatch(inputs);
  }
  if (typeof modelProvider.embed === 'function') {
    return Promise.all(inputs.map((input) => modelProvider.embed(input)));
  }
  return [];
}

function normalizeModelResult(rawResult) {
  if (Array.isArray(rawResult)) {
    return rawResult;
  }
  if (Array.isArray(rawResult?.embeddings)) {
    return rawResult.embeddings;
  }
  if (Array.isArray(rawResult?.data)) {
    return rawResult.data;
  }
  return [];
}

function modelEmbeddingFor(resultsById, indexedResults, input, index) {
  const byId = resultsById.get(input.id);
  const result = byId ?? indexedResults[index];
  if (Array.isArray(result)) {
    return normalizeEmbedding(result);
  }
  return normalizeEmbedding(
    result?.embedding ??
      result?.vector ??
      result?.embeddingVector ??
      result?.embedding_vector,
  );
}

function resultMap(modelResults) {
  const byId = new Map();
  for (const result of modelResults) {
    const id = stableString(result?.id ?? result?.caseId ?? result?.taskId);
    if (id) {
      byId.set(id, result);
    }
  }
  return byId;
}

function fallbackEmbeddingFor(input, dimensions) {
  return deterministicFallbackEmbedding({
    ...input,
    prompt: input.text,
    summary: input.summary ?? input.text,
  }, input.id, dimensions);
}

export function createEmbeddingProvider(options = {}) {
  const {
    modelProvider,
    fallback = {},
  } = options;
  const gate = normalizeGate(options);
  const modelEnabled = modelBackedEmbeddingsEnabled(gate);
  const dimensions = fallbackDimensions(fallback);

  async function embedTextBatch(inputs = []) {
    const normalizedInputs = normalizeTextInputs(inputs);
    let modelProviderError = null;
    let rawModelResults = [];
    if (modelEnabled) {
      try {
        rawModelResults = await callModelProvider(modelProvider, normalizedInputs);
      } catch {
        modelProviderError = { type: 'model_provider_error' };
      }
    }
    const modelResults = normalizeModelResult(rawModelResults);
    const resultsById = resultMap(modelResults);
    const embeddings = normalizedInputs.map((input, index) => {
      const modelEmbedding = modelEnabled
        ? modelEmbeddingFor(resultsById, modelResults, input, index)
        : null;
      const embedding = modelEmbedding ?? fallbackEmbeddingFor(input, dimensions);
      const source = modelEmbedding ? 'model' : (embedding ? 'fallback' : 'none');
      return {
        id: input.id,
        text: input.text,
        embedding,
        source,
        fallbackReason: source === 'fallback' && modelProviderError
          ? modelProviderError.type
          : undefined,
        modelBacked: source === 'model',
        authority: 'evidence_only',
        promotionAllowed: false,
      };
    });
    const embeddingById = new Map(
      embeddings
        .filter((entry) => entry.embedding)
        .map((entry) => [entry.id, entry.embedding]),
    );
    return {
      embeddings,
      embeddingById,
      modelBacked: embeddings.some((entry) => entry.source === 'model'),
      modelProviderError,
      fallbackDimensions: dimensions,
      authority: 'evidence_only',
      promotionAllowed: false,
    };
  }

  async function embedCaseBatch(cases = []) {
    const normalizedCases = normalizeCaseInputs(cases);
    const result = await embedTextBatch(normalizedCases);
    return {
      ...result,
      embeddings: result.embeddings.map((entry, index) => ({
        ...entry,
        caseId: normalizedCases[index].id,
        domain: normalizedCases[index].domain ?? null,
      })),
    };
  }

  return {
    embedTextBatch,
    embedCaseBatch,
  };
}
