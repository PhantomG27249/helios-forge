import { repairJsonObject } from '../model/structuredOutputRepair.js';
import { buildRolePrompt } from './rolePrompts.js';
import { normalizeCompactHandoff, scoreCompactHandoff } from './subagentRunner.js';
import {
  normalizeSwarmCellOutput,
  validateSwarmCellContract,
} from './swarmCellContracts.js';

const MODEL_WORKER_REQUIRED_FIELDS = ['summary', 'patch or verifierEvidence'];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasVerifierEvidence(value) {
  return asArray(value).some((item) => {
    if (typeof item === 'string') return item.trim().length > 0;
    return item !== undefined && item !== null;
  });
}

function parseModelPayload(payload) {
  if (typeof payload === 'string') {
    try {
      return repairJsonObject(payload);
    } catch (error) {
      throw new Error(`Malformed model worker output: invalid JSON (${error.message})`);
    }
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Malformed model worker output: expected JSON object');
  }

  return payload;
}

function extractModelPayload(response) {
  if (response?.structured !== undefined && response.structured !== null) return response.structured;
  if (response?.output !== undefined && response.output !== null) return response.output;
  if (response?.text !== undefined && response.text !== null) return response.text;
  if (response?.content !== undefined && response.content !== null) return response.content;
  return response;
}

function assertNoToolCalls(output) {
  const hasToolCallPayload = (value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null;
  };
  if (
    hasToolCallPayload(output.toolCalls)
    || hasToolCallPayload(output.tool_calls)
    || hasToolCallPayload(output.toolCall)
    || (output.tool !== undefined && output.args !== undefined)
  ) {
    throw new Error('Model worker does not execute tool calls');
  }
}

function normalizeScore(score) {
  if (score === undefined || score === null || score === '') return 0;
  const normalized = Number(score);
  return Number.isFinite(normalized) ? normalized : 0;
}

function safeModelRoute(route = null) {
  if (!route) return undefined;
  const metadata = {
    role: route.role,
    modelProfile: route.modelProfile,
    endpointProfile: route.endpointProfile,
    authority: 'evidence_only',
    canPromote: false,
  };
  if (route.endpoint) {
    metadata.endpoint = {
      baseUrl: route.endpoint.baseUrl,
      modelId: route.endpoint.modelId,
    };
    if (typeof route.endpoint.supportsVision === 'boolean') {
      metadata.endpoint.supportsVision = route.endpoint.supportsVision;
    }
    if (typeof route.endpoint.healthEnabled === 'boolean') {
      metadata.endpoint.healthEnabled = route.endpoint.healthEnabled;
    }
  }
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
}

function modelMetadata(response, profileName, requestId, modelRoute) {
  const profile = response?.profile || {};
  const metadata = {
    callId: response?.callId || null,
    profileName: profile.name || profileName || null,
    model: profile.model || null,
    usage: response?.usage || null,
  };
  if (requestId) metadata.requestId = response?.requestId || requestId;
  const route = safeModelRoute(modelRoute);
  if (route) metadata.route = route;
  return metadata;
}

export function normalizeModelWorkerOutput({
  response,
  attempt = {},
  role = 'implementer',
  profileName,
  requestId,
  modelRoute,
} = {}) {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    assertNoToolCalls(response);
  }
  const output = parseModelPayload(extractModelPayload(response));
  assertNoToolCalls(output);

  if (!hasNonEmptyString(output.summary)) {
    throw new Error('Malformed model worker output: missing summary');
  }

  if (!hasNonEmptyString(output.patch) && !hasVerifierEvidence(output.verifierEvidence)) {
    throw new Error('Malformed model worker output: expected patch or verifierEvidence');
  }
  const normalizedOutput = {
    ...output,
    verifierEvidence: asArray(output.verifierEvidence),
    verifierCommands: asArray(output.verifierCommands),
    artifacts: asArray(output.artifacts),
    risks: asArray(output.risks),
  };
  const compactHandoff = normalizeCompactHandoff(normalizedOutput);
  const swarmCellOutput = normalizeSwarmCellOutput({
    taskOutput: normalizedOutput,
    evolutionOutput: output.evolutionOutput || output.evolution || {},
  });
  const swarmCellContract = validateSwarmCellContract({
    taskOutput: normalizedOutput,
    evolutionOutput: output.evolutionOutput || output.evolution || {},
  });

  const contractValid = swarmCellContract.valid;

  return {
    attemptId: attempt.attemptId,
    role,
    strategy: attempt.strategy,
    summary: output.summary,
    patch: hasNonEmptyString(output.patch) ? output.patch : '',
    verifierEvidence: normalizedOutput.verifierEvidence,
    verifierCommands: normalizedOutput.verifierCommands,
    score: normalizeScore(output.score),
    artifacts: normalizedOutput.artifacts,
    risks: normalizedOutput.risks,
    taskOutput: swarmCellOutput.taskOutput,
    evolutionOutput: swarmCellOutput.evolutionOutput,
    compactHandoff,
    handoffQuality: scoreCompactHandoff(compactHandoff),
    status: contractValid ? 'completed' : 'contract_failed',
    contract: {
      requiredFields: MODEL_WORKER_REQUIRED_FIELDS,
      missingFields: [],
      reasons: swarmCellContract.reasons,
      valid: swarmCellContract.valid,
    },
    model: modelMetadata(response, profileName, requestId, modelRoute),
  };
}

function buildModelWorkerMessages({ prompt }) {
  return [
    {
      role: 'system',
      content: [
        'You are a Helios Forge model-driven swarm worker.',
        'Return one JSON object only. Do not request or emit executable tool calls.',
        'Verifier commands may be suggested as text in verifierCommands, but this worker will not execute them.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        prompt.text,
        '',
        'Output contract:',
        '- summary: required string',
        '- patch: unified diff string, required unless verifierEvidence is present',
        '- verifierEvidence: evidence array or string, required unless patch is present',
        '- optional: verifierCommands, score, artifacts, risks',
      ].join('\n'),
    },
  ];
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
  if (typeof provider?.call === 'function') {
    return provider.call(callInput);
  }

  throw new Error('Model-driven worker requires an injected modelGateway or provider');
}

export async function runModelDrivenAttempt({
  task = {},
  attempt = {},
  role = 'implementer',
  context = {},
  budget = {},
  profileName = 'critic_low_temp',
  modelRoute,
  modelGateway,
  provider,
  requestId,
} = {}) {
  const prompt = buildRolePrompt({
    role,
    task,
    attempt,
    context,
    budget,
    outputContract: { requiredFields: MODEL_WORKER_REQUIRED_FIELDS },
  });
  const callInput = {
    requestId,
    taskId: task.taskId,
    purpose: 'swarm_model_worker',
    profileName,
    modelRoute,
    task,
    attempt,
    role,
    context,
    budget,
    outputContract: { requiredFields: MODEL_WORKER_REQUIRED_FIELDS },
    prompt,
    messages: buildModelWorkerMessages({ prompt }),
    structuredOutput: true,
  };

  const response = await callInjectedModel({ modelGateway, provider, callInput });
  return normalizeModelWorkerOutput({ response, attempt, role, profileName, requestId, modelRoute });
}

export const runModelDrivenWorker = runModelDrivenAttempt;
