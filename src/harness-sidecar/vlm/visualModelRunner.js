import { buildMultimodalRequest } from '../model/multimodalRequestBuilder.js';
import { getModelProfile } from '../model/modelProfiles.js';
import { repairJsonObject } from '../model/structuredOutputRepair.js';
import { readImageArtifact } from './imageIO.js';
import { decideMultimodalBudgetPolicy } from './visualContextPolicy.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveEndpointProfile(profileName, profileOverride) {
  try {
    return {
      ...getModelProfile(profileName),
      ...(profileOverride || {}),
    };
  } catch (error) {
    if (!profileOverride) throw error;
    return {
      name: profileName,
      supportsVision: false,
      ...profileOverride,
    };
  }
}

function parseModelPayload(response) {
  if (response?.structured !== undefined && response.structured !== null) return response.structured;
  const payload = response?.output ?? response?.text ?? response?.content ?? response;
  if (typeof payload === 'string') {
    try {
      return repairJsonObject(payload);
    } catch (error) {
      throw new Error(`Malformed VLM output: invalid JSON (${error.message})`);
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Malformed VLM output: expected JSON object');
  }
  return payload;
}

function normalizeObservation(observation, index) {
  if (typeof observation === 'string') {
    const text = observation.trim();
    if (!text) return null;
    return { id: `obs_${index + 1}`, text };
  }
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return null;
  }
  const text = String(observation.text || observation.summary || '').trim();
  if (!text) return null;
  return {
    id: observation.id || `obs_${index + 1}`,
    text,
    confidence: observation.confidence,
    artifactId: observation.artifactId,
  };
}

function normalizeRisk(risk) {
  if (typeof risk === 'string') {
    const description = risk.trim();
    return description ? { description } : null;
  }
  if (!risk || typeof risk !== 'object' || Array.isArray(risk)) return null;
  const description = String(risk.description || risk.risk || risk.text || '').trim();
  if (!description) return null;
  return {
    description,
    severity: risk.severity,
  };
}

function normalizeScore(score) {
  if (score === undefined || score === null || score === '') return null;
  const normalized = Number(score);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    throw new Error('Malformed VLM output: score must be between 0 and 1');
  }
  return normalized;
}

function normalizeUsage(usage) {
  if (!usage) return null;
  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
  };
}

export function normalizeVisualModelOutput({ response, profileName } = {}) {
  const payload = parseModelPayload(response);
  if (!Array.isArray(payload.observations)) {
    throw new Error('Malformed VLM output: observations must be an array');
  }

  const observations = payload.observations
    .map((observation, index) => normalizeObservation(observation, index))
    .filter(Boolean);
  if (observations.length === 0) {
    throw new Error('Malformed VLM output: at least one observation is required');
  }

  return {
    observations,
    ocrText: typeof payload.ocrText === 'string' ? payload.ocrText : null,
    risks: asArray(payload.risks).map(normalizeRisk).filter(Boolean),
    score: normalizeScore(payload.score),
    artifacts: asArray(payload.artifacts),
    model: {
      callId: response?.callId || null,
      profileName: response?.profile?.name || profileName || null,
      model: response?.profile?.model || null,
    },
    usage: normalizeUsage(response?.usage),
  };
}

function buildVisualItems(images) {
  return images.map((image, index) => ({
    artifactId: `image_${index + 1}`,
    type: 'image_artifact',
    artifact: {
      type: 'image_artifact',
      path: image.path,
      mimeType: image.mimeType,
      metadata: image.metadata,
    },
  }));
}

function enrichRequestWithDataUrls({ request, images }) {
  const imageByPath = new Map(images.map((image) => [image.path, image]));
  const content = request.messages[0].content.map((part) => {
    if (part.type !== 'image_reference') return part;
    const image = imageByPath.get(part.path);
    if (!image) return part;
    return {
      type: 'image_url',
      artifactId: part.artifactId,
      kind: part.kind,
      image_url: { url: image.dataUrl },
      metadata: image.metadata,
    };
  });

  return {
    ...request,
    messages: [{ ...request.messages[0], content }],
    visionInputs: request.visionInputs.map((input) => {
      const image = imageByPath.get(input.path);
      return image
        ? { ...input, mimeType: image.mimeType, dataUrl: image.dataUrl, metadata: image.metadata }
        : input;
    }),
  };
}

async function callInjectedModel({ modelGateway, provider, callInput }) {
  if (modelGateway?.call) {
    return modelGateway.call(callInput);
  }
  if (typeof modelGateway === 'function') {
    return modelGateway(callInput);
  }
  if (typeof provider === 'function') {
    return provider(callInput);
  }
  throw new Error('Visual model runner requires an injected modelGateway or provider');
}

export async function runVisualModelObservation({
  taskId,
  prompt,
  imagePaths = [],
  workspaceRoot,
  artifactRoots = [],
  maxImageBytes,
  profileName = 'qwen36_vlm_fast',
  modelGateway,
  provider,
  budget = {},
  adaptiveAction,
} = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Visual model prompt is required');
  }
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new Error('Visual model runner requires at least one image path');
  }

  const images = await Promise.all(
    imagePaths.map((imagePath) =>
      readImageArtifact({
        imagePath,
        workspaceRoot,
        artifactRoots,
        maxBytes: maxImageBytes,
      }),
    ),
  );
  const profileOverride = modelGateway?.profileOverrides?.[profileName];
  const endpoint = resolveEndpointProfile(profileName, profileOverride);
  const visualItems = buildVisualItems(images);
  const multimodalBudgetPolicy = decideMultimodalBudgetPolicy({
    task: { taskId, vlmRequired: true },
    endpoint,
    visualItems,
    budget,
    adaptiveAction,
  });
  const request = buildMultimodalRequest({
    profileName,
    profileOverride,
    prompt: [
      prompt,
      '',
      'Return one JSON object only with: observations array, optional ocrText string, risks array, score number 0..1, and artifacts array.',
      'Do not request tool calls. OCR text may be provided only if visible in the supplied image.',
    ].join('\n'),
    visualItems,
    multimodalBudgetPolicy,
  });
  const enrichedRequest = enrichRequestWithDataUrls({ request, images });
  const callInput = {
    taskId,
    purpose: 'vlm_observation',
    profileName,
    messages: enrichedRequest.messages,
    structuredOutput: true,
    visionInputs: enrichedRequest.visionInputs,
    tokensEstimated: enrichedRequest.tokensEstimated,
  };

  const response = await callInjectedModel({ modelGateway, provider, callInput });
  return normalizeVisualModelOutput({ response, profileName });
}
