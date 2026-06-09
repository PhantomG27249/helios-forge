import { PiRpcManager } from '../../pi/piRpcManager.js';
import { buildSwarmA2AEnvelope } from '../interop/a2aSwarmEnvelope.js';
import { repairJsonObject } from '../model/structuredOutputRepair.js';
import { normalizeCompactHandoff, scoreCompactHandoff } from './subagentRunner.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function hasVerifierEvidence(value) {
  return asArray(value).some((item) => {
    if (typeof item === 'string') return item.trim().length > 0;
    return item !== undefined && item !== null;
  });
}

function requiredFieldPresent(output = {}, field) {
  const value = output?.[field];
  if (field === 'verifierEvidence') return hasVerifierEvidence(value);
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function missingRequiredFields(output = {}, requiredFields = []) {
  return requiredFields.filter((field) => !requiredFieldPresent(output, field));
}

function inferPatchStats(output = {}) {
  if (output.patchStats) return output.patchStats;
  if (typeof output.patch !== 'string') return { changedLines: 0 };
  const changedLines = output.patch
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---'))
    .length;
  return { changedLines };
}

function fallbackValueForRequiredField(field, output = {}) {
  if (field === 'summary') return output.summary || 'Pi-native worker returned a natural-language handoff.';
  if (field === 'patch') return output.patch || 'No patch was proposed by the Pi-native worker.';
  if (field === 'verifierEvidence') {
    return hasVerifierEvidence(output.verifierEvidence)
      ? output.verifierEvidence
      : [{
          verifier: 'pi_native_handoff_adapter',
          status: 'warning',
          summary: 'Natural-language handoff received; structured verifier evidence was not provided.',
        }];
  }
  if (field === 'testEvidence') return output.testEvidence || ['No structured test evidence was provided.'];
  if (field === 'visualEvidence') return output.visualEvidence || ['No structured visual evidence was provided.'];
  if (field === 'researchFindings') return output.researchFindings || [output.summary || 'Natural-language research handoff received.'];
  if (field === 'sources') return output.sources || ['pi_native_worker_message'];
  if (field === 'reviewFindings') return output.reviewFindings || [output.summary || 'Natural-language review handoff received.'];
  if (field === 'riskFindings') return output.riskFindings || output.risks || ['No structured risk findings were provided.'];
  if (field === 'approvalNotes') return output.approvalNotes || ['No structured approval notes were provided.'];
  if (field === 'sourceAttemptIds') return output.sourceAttemptIds || ['pi_native_worker_message'];
  return output[field] || `No structured ${field} was provided.`;
}

function fillContractDefaults(output = {}, requiredFields = []) {
  const adapted = { ...output };
  let adaptedAny = false;
  for (const field of requiredFields) {
    if (!requiredFieldPresent(adapted, field)) {
      adapted[field] = fallbackValueForRequiredField(field, adapted);
      adaptedAny = true;
    }
  }
  if (adaptedAny) {
    adapted.contractFallback = {
      used: true,
      reason: 'pi_native_natural_language_handoff',
      requiredFields,
    };
    if (!Number.isFinite(Number(adapted.score))) adapted.score = 15;
  }
  return adapted;
}

async function defaultPiWorkerFactory({ workspaceRoot, capabilitiesManifest } = {}) {
  const manager = new PiRpcManager({
    initialCwd: workspaceRoot || process.cwd(),
  });
  if (capabilitiesManifest) manager.setCapabilitiesManifest(capabilitiesManifest);
  return manager;
}

async function stopWorker(worker) {
  if (!worker) return;
  if (typeof worker.stop === 'function') {
    await worker.stop();
    return;
  }
  if (typeof worker.stopForRestart === 'function') {
    await worker.stopForRestart();
  }
}

function payloadFromMessageContent(content) {
  if (typeof content === 'string') {
    try {
      return repairJsonObject(content);
    } catch {
      return content;
    }
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) return payloadFromMessageContent(text);
  }
  if (content && typeof content === 'object') return content;
  return null;
}

function payloadFromMessagesResponse(response = {}) {
  const messages = response?.data?.messages
    || response?.data?.conversation?.messages
    || response?.data?.session?.messages
    || response?.messages
    || response?.output?.messages;
  if (!Array.isArray(messages)) return null;

  for (const message of [...messages].reverse()) {
    const role = String(message?.role || message?.author || '').toLowerCase();
    if (role && !role.includes('assistant') && !role.includes('agent')) continue;
    const payload = payloadFromMessageContent(message?.content || message?.text || message?.message);
    if (payload) return payload;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollForMessagesPayload({ worker, attempts = 10, intervalMs = 500 } = {}) {
  if (typeof worker?.sendCommand !== 'function') return null;
  for (let index = 0; index < attempts; index += 1) {
    if (index > 0) await sleep(intervalMs);
    const messagesResponse = await worker.sendCommand({ type: 'get_messages' });
    const payload = payloadFromMessagesResponse(messagesResponse);
    if (payload) return payload;
  }
  return null;
}

function responseHasDirectPayload(response = {}) {
  return response.data !== undefined || response.output !== undefined || response.structured !== undefined;
}

async function responsePayload({ response = {}, worker } = {}) {
  const looksLikePromptAck = response?.type === 'response'
    && response?.command === 'prompt'
    && response?.success === true;
  if (looksLikePromptAck && typeof worker?.sendCommand === 'function') {
    try {
      return await pollForMessagesPayload({ worker }) || response;
    } catch {
      return response;
    }
  }
  if (responseHasDirectPayload(response)) {
    return response.data || response.output || response.structured;
  }
  return response;
}

function normalizeOutput(payload = {}, outputContract = {}) {
  const requiredFields = outputContract.requiredFields || [];
  if (typeof payload === 'string') {
    return fillContractDefaults({ summary: payload, verifierEvidence: [] }, requiredFields);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fillContractDefaults({
      summary: 'Pi-native worker returned no structured output.',
      verifierEvidence: [],
    }, requiredFields);
  }
  return fillContractDefaults({
    ...payload,
    verifierEvidence: asArray(payload.verifierEvidence),
    verifierCommands: asArray(payload.verifierCommands),
    artifacts: asArray(payload.artifacts),
    risks: asArray(payload.risks),
  }, requiredFields);
}

function traceEvent({ taskId, attemptId, phase, summary, severity = 'info', details }) {
  return {
    type: 'swarm.subagent_trace',
    taskId,
    attemptId,
    phase,
    severity,
    summary,
    details,
    timestamp: new Date().toISOString(),
  };
}

export async function runPiNativeAttempt({
  task = {},
  attempt = {},
  role = 'implementer',
  context = {},
  budget = {},
  outputContract = { requiredFields: ['summary', 'verifierEvidence'] },
  workspaceRoot,
  capabilitiesManifest,
  piWorkerFactory = defaultPiWorkerFactory,
  emitTrace,
} = {}) {
  const taskId = task.taskId || 'task_swarm';
  const attemptId = attempt.attemptId || 'attempt_pi_native';
  const startedAt = new Date().toISOString();
  const emit = (event) => {
    if (typeof emitTrace === 'function') emitTrace(event);
  };
  const a2a = buildSwarmA2AEnvelope({
    task: { ...task, taskId },
    attempt: { ...attempt, attemptId },
    role,
    context,
    budget,
    outputContract,
  });

  emit(traceEvent({
    taskId,
    attemptId,
    phase: 'planned',
    summary: `${role} ${attemptId} assigned through local A2A envelope`,
    details: { strategy: attempt.strategy, workerKind: 'pi_native_subagent' },
  }));

  let worker;
  try {
    worker = await piWorkerFactory({
      task: { ...task, taskId },
      attempt: { ...attempt, attemptId },
      role,
      context,
      budget,
      outputContract,
      workspaceRoot,
      capabilitiesManifest,
      a2a,
    });
    if (typeof worker.start === 'function') await worker.start();

    emit(traceEvent({
      taskId,
      attemptId,
      phase: 'prompt_built',
      summary: `Prompting Pi-native ${role} worker`,
      details: {
        requiredFields: outputContract.requiredFields || [],
        allowedFileCount: Array.isArray(context.allowedFiles) ? context.allowedFiles.length : 0,
      },
    }));

    const response = await worker.sendCommand({
      type: 'prompt',
      message: [
        `You are Helios Forge Pi-native swarm worker ${attemptId}.`,
        `Role: ${role}`,
        `Task: ${task.task || task.goal || ''}`,
        'Return one compact JSON object only. Do not narrate before or after the JSON.',
        `Required top-level fields: ${(outputContract.requiredFields || []).join(', ') || 'summary'}.`,
        'Always include compactHandoff with summary, filesInspected, filesChanged, commandsRun, testsRun, nextAction, sourcePointers, uncertainty, and risks.',
        'If no patch is needed, set patch to a short explanation string and include verifierEvidence explaining why.',
      ].join('\n'),
      a2a,
      streamingBehavior: 'block_until_done',
    });
    const output = normalizeOutput(await responsePayload({ response, worker }), outputContract);
    const compactHandoff = normalizeCompactHandoff(output);
    const handoffQuality = scoreCompactHandoff(compactHandoff);
    const verifierEvidence = output.verifierEvidence || [];
    const requiredFields = outputContract.requiredFields || [];
    const missingFields = missingRequiredFields(output, requiredFields);
    const valid = missingFields.length === 0;

    emit(traceEvent({
      taskId,
      attemptId,
      phase: 'handoff_created',
      summary: output.summary || `${attemptId} returned handoff`,
      details: {
        verifierEvidenceCount: verifierEvidence.length,
        handoffQuality,
      },
    }));

    return {
      ...attempt,
      attemptId,
      role,
      status: valid ? 'completed' : 'contract_failed',
      output,
      compactHandoff,
      handoffQuality,
      thinkingSummary: output.thinkingSummary || output.visibleThinkingSummary || null,
      verifierPassed: verifierEvidence.length > 0,
      verifierEvidence,
      score: Number.isFinite(Number(output.score)) ? Number(output.score) : 0,
      patchStats: inferPatchStats(output),
      worker: {
        kind: 'pi_native_subagent',
        protocol: 'a2a',
      },
      model: output.model || null,
      contract: {
        requiredFields,
        missingFields,
        valid: Boolean(valid),
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    emit(traceEvent({
      taskId,
      attemptId,
      phase: 'failed',
      severity: 'error',
      summary: error.message,
    }));
    return {
      ...attempt,
      attemptId,
      role,
      status: 'failed',
      output: null,
      compactHandoff: normalizeCompactHandoff({ summary: error.message, risks: ['pi_native_worker_failed'] }),
      handoffQuality: scoreCompactHandoff({ summary: error.message, risks: ['pi_native_worker_failed'] }),
      verifierPassed: false,
      verifierEvidence: [],
      score: 0,
      patchStats: { changedLines: 0 },
      worker: {
        kind: 'pi_native_subagent',
        protocol: 'a2a',
      },
      failure: {
        reason: 'pi_native_worker_failed',
        message: error.message,
        retryable: true,
      },
      contract: {
        requiredFields: outputContract.requiredFields || [],
        missingFields: outputContract.requiredFields || [],
        valid: false,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } finally {
    await stopWorker(worker);
  }
}
