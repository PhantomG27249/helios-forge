import { PiRpcManager } from '../../pi/piRpcManager.js';
import { redactSecrets } from '../interop/agentCards.js';
import { buildSwarmA2AEnvelope } from '../interop/a2aSwarmEnvelope.js';
import { repairJsonObject } from '../model/structuredOutputRepair.js';
import { normalizeCompactHandoff, scoreCompactHandoff } from './subagentRunner.js';
import {
  normalizeEvolutionOutput,
  normalizeSwarmCellOutput,
  validateSwarmCellContract,
} from './swarmCellContracts.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function safeObject(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactRef(ref = {}, idKeys = [], versionKeys = []) {
  const id = idKeys.map((key) => ref[key]).find(Boolean);
  const version = versionKeys.map((key) => ref[key]).find(Boolean);
  if (!id) return null;
  return version ? `${id}@${version}` : String(id);
}

function boundedText(value, maxLength = 160) {
  const text = String(value || '')
    .replace(/[A-Za-z]:\\[^\s"'`<>]+/g, '[path]')
    .replace(/(^|[\s"'`<>()])\/(?!\/)(?:[^\s"'`<>/]+\/){2,}[^\s"'`<>]+/g, '$1[path]')
    .replace(/\b(?:api[_-]?key|token|secret|password)=\S+/gi, '$1=[redacted]')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function skillHintLabel(hint) {
  if (typeof hint === 'string') return hint.trim();
  return String(hint?.id || hint?.skillId || hint?.name || '').trim();
}

function compactSkillHint(hint) {
  const id = skillHintLabel(hint);
  if (!id) return null;
  return {
    id: boundedText(id, 96),
    reason: boundedText(hint?.reason || hint?.description || '', 160) || undefined,
  };
}

function compactStructuredRef(ref = {}, idKeys = [], versionKeys = []) {
  const id = idKeys.map((key) => ref[key]).find(Boolean);
  if (!id) return null;
  const version = versionKeys.map((key) => ref[key]).find(Boolean);
  return {
    id: boundedText(id, 96),
    version: version ? boundedText(version, 64) : undefined,
  };
}

function candidateLabel(candidate = {}) {
  const id = candidate.candidateId || candidate.id || candidate.ref || 'candidate';
  const source = candidate.source || candidate.kind || 'helios';
  return `${id}:${source}`;
}

function compactCandidate(candidate = {}) {
  const id = candidate.candidateId || candidate.id || candidate.ref;
  if (!id) return null;
  return {
    id: boundedText(id, 96),
    source: boundedText(candidate.source || candidate.kind || 'helios', 48),
    operator: boundedText(candidate.operator || '', 64) || undefined,
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : undefined,
  };
}

function modelWarningText(warning) {
  if (typeof warning === 'string') return warning.trim();
  return String(warning?.message || warning?.summary || warning?.code || '').trim();
}

function compactModelWarning(warning) {
  if (typeof warning === 'string') return { message: boundedText(warning, 180) };
  const message = boundedText(warning?.message || warning?.summary || warning?.code || '', 180);
  if (!message) return null;
  return {
    code: boundedText(warning?.code || '', 80) || undefined,
    message,
  };
}

function countByType(capabilities = []) {
  const counts = {};
  for (const capability of capabilities) {
    const type = boundedText(capability?.type || 'unknown', 48);
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function compactCapabilityRef(capability = {}) {
  const id = capability.id || capability.capabilityId;
  if (!id) return null;
  return {
    id: boundedText(id, 120),
    type: boundedText(capability.type || 'unknown', 48),
    name: boundedText(capability.name || id, 120),
    enabled: capability.enabled !== false,
  };
}

function compactCapabilitiesManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const refs = capabilities.map(compactCapabilityRef).filter(Boolean).slice(0, 16);
  const counts = manifest.counts && typeof manifest.counts === 'object'
    ? Object.fromEntries(
      Object.entries(manifest.counts)
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([key, value]) => [boundedText(key, 48), Number(value)]),
    )
    : countByType(capabilities);
  return {
    id: boundedText(manifest.id || manifest.manifestId || 'capabilities', 96),
    version: boundedText(manifest.version || '', 64) || undefined,
    counts,
    refs,
    truncated: capabilities.length > refs.length || undefined,
  };
}

function compactCallbackHints(hints = {}) {
  const allowedKeys = ['progressEndpoint', 'handoffEndpoint', 'statusEndpoint'];
  return Object.fromEntries(
    allowedKeys
      .map((key) => [key, boundedText(hints[key], 256)])
      .filter(([, value]) => value),
  );
}

function compactModelConcurrencyHints(hints = {}) {
  if (!hints || typeof hints !== 'object' || Array.isArray(hints)) return undefined;
  const concurrency = Number(hints.concurrency);
  const maxConcurrency = Number(hints.maxConcurrency);
  const probeConcurrency = Number(hints.probeConcurrency);
  const result = {
    baseUrl: boundedText(hints.baseUrl || hints.endpoint || '', 256) || undefined,
    modelId: boundedText(hints.modelId || hints.model || '', 160) || undefined,
    profileName: boundedText(hints.profileName || hints.profile || '', 96) || undefined,
    workerMode: boundedText(hints.workerMode || '', 48) || undefined,
    source: boundedText(hints.source || '', 64) || undefined,
    healthUrl: boundedText(hints.healthUrl || '', 256) || undefined,
    healthy: typeof hints.healthy === 'boolean' ? hints.healthy : undefined,
    concurrency: Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : undefined,
    maxConcurrency: Number.isFinite(maxConcurrency) ? Math.max(1, Math.floor(maxConcurrency)) : undefined,
    probeConcurrency: Number.isFinite(probeConcurrency) ? Math.max(1, Math.floor(probeConcurrency)) : undefined,
    p95LatencyMs: Number.isFinite(Number(hints.p95LatencyMs)) ? Number(hints.p95LatencyMs) : undefined,
  };
  const compacted = Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
  return Object.keys(compacted).length ? compacted : undefined;
}

function normalizeBridgeContext({
  piBridgeContext,
  capabilitiesManifest,
  outputContract,
} = {}) {
  const bridge = safeObject(piBridgeContext);
  const taskCorrelationId = bridge.taskCorrelationId || bridge.correlationId;
  return redactSecrets({
    skillHints: asArray(bridge.skillHints).map(compactSkillHint).filter(Boolean).slice(0, 16),
    soulRefs: asArray(bridge.soulRefs || bridge.souls)
      .map((ref) => compactStructuredRef(ref, ['soulId', 'id'], ['soulVersion', 'version']))
      .filter(Boolean)
      .slice(0, 16),
    oversoulRefs: asArray(bridge.oversoulRefs || bridge.oversouls)
      .map((ref) => compactStructuredRef(ref, ['oversoulId', 'id'], ['oversoulVersion', 'version']))
      .filter(Boolean)
      .slice(0, 16),
    outputContract: {
      requiredFields: asArray(outputContract?.requiredFields)
        .map((field) => boundedText(field, 64))
        .filter(Boolean)
        .slice(0, 24),
    },
    taskCorrelationId: boundedText(taskCorrelationId, 128) || undefined,
    sidecarCallbackHints: compactCallbackHints(safeObject(bridge.sidecarCallbackHints || bridge.callbacks)),
    modelConcurrency: compactModelConcurrencyHints(bridge.modelConcurrency || bridge.vllmConcurrency),
    capabilitiesManifest: compactCapabilitiesManifest(capabilitiesManifest || bridge.capabilitiesManifest),
    mutationOptimization: {
      heliosDeterministicCandidates: asArray(
        bridge.mutationOptimization?.heliosDeterministicCandidates
        || bridge.heliosDeterministicCandidates,
      ).map(compactCandidate).filter(Boolean).slice(0, 16),
      piNativeSuggestionPolicy: {
        source: boundedText(
          bridge.mutationOptimization?.piNativeSuggestionPolicy?.source
          || bridge.piNativeSuggestionPolicy?.source
          || 'pi_native_model_suggestions',
          64,
        ),
        mode: boundedText(
          bridge.mutationOptimization?.piNativeSuggestionPolicy?.mode
          || bridge.piNativeSuggestionPolicy?.mode
          || '',
          64,
        ) || undefined,
        authority: 'advisory_only',
      },
    },
    modelWarnings: asArray(bridge.modelWarnings || bridge.warnings)
      .map(compactModelWarning)
      .filter(Boolean)
      .slice(0, 8),
    authorityBoundary: {
      durableApplyApproval: 'forbidden_for_pi_native',
      piNativeOutput: 'advisory_only',
    },
  });
}

function hasBridgeContextData({ piBridgeContext, capabilitiesManifest } = {}) {
  return Object.keys(safeObject(piBridgeContext)).length > 0 || capabilitiesManifest !== undefined;
}

function bridgePromptLines(bridgeContext = {}) {
  const lines = [];
  const skillHints = asArray(bridgeContext.skillHints).map(skillHintLabel).filter(Boolean);
  if (skillHints.length) lines.push(`Skill hints: ${skillHints.join(', ')}`);

  const soulRefs = asArray(bridgeContext.soulRefs)
    .map((ref) => compactRef(ref, ['soulId', 'id'], ['soulVersion', 'version']))
    .filter(Boolean);
  if (soulRefs.length) lines.push(`Soul refs: ${soulRefs.join(', ')}`);

  const oversoulRefs = asArray(bridgeContext.oversoulRefs)
    .map((ref) => compactRef(ref, ['oversoulId', 'id'], ['oversoulVersion', 'version']))
    .filter(Boolean);
  if (oversoulRefs.length) lines.push(`Oversoul refs: ${oversoulRefs.join(', ')}`);

  if (bridgeContext.taskCorrelationId) {
    lines.push(`Task correlation id: ${bridgeContext.taskCorrelationId}`);
  }

  const candidates = asArray(bridgeContext.mutationOptimization?.heliosDeterministicCandidates)
    .map(candidateLabel)
    .filter(Boolean);
  if (candidates.length) {
    lines.push(`Helios deterministic mutation candidates (BES/RHO): ${candidates.join(', ')}`);
  }

  lines.push('Pi-native model suggestions are advisory only; separate them from Helios BES/RHO candidates.');
  lines.push('Do not approve or apply durable local changes. Return proposals and evidence only.');

  const warnings = asArray(bridgeContext.modelWarnings).map(modelWarningText).filter(Boolean);
  if (warnings.length) lines.push(`Bridge warnings: ${warnings.join(' ')}`);
  if (bridgeContext.modelConcurrency) {
    const hints = bridgeContext.modelConcurrency;
    lines.push(
      [
        'Model concurrency hints:',
        hints.modelId ? `model=${hints.modelId}` : null,
        hints.baseUrl ? `endpoint=${hints.baseUrl}` : null,
        hints.workerMode ? `workerMode=${hints.workerMode}` : null,
        hints.concurrency ? `concurrency=${hints.concurrency}` : null,
        hints.maxConcurrency ? `max=${hints.maxConcurrency}` : null,
        hints.source ? `source=${hints.source}` : null,
      ].filter(Boolean).join(' '),
    );
  }
  return lines;
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
  piBridgeContext,
  piWorkerFactory = defaultPiWorkerFactory,
  emitTrace,
} = {}) {
  const taskId = task.taskId || 'task_swarm';
  const attemptId = attempt.attemptId || 'attempt_pi_native';
  const startedAt = new Date().toISOString();
  const emit = (event) => {
    if (typeof emitTrace === 'function') emitTrace(event);
  };
  const shouldIncludeBridgeContext = hasBridgeContextData({ piBridgeContext, capabilitiesManifest });
  const bridgeContext = shouldIncludeBridgeContext
    ? normalizeBridgeContext({
        piBridgeContext,
        capabilitiesManifest,
        outputContract,
      })
    : null;
  const a2a = buildSwarmA2AEnvelope({
    task: { ...task, taskId },
    attempt: { ...attempt, attemptId },
    role,
    context,
    budget,
    outputContract,
    durable: bridgeContext?.taskCorrelationId
      ? { correlationId: bridgeContext.taskCorrelationId }
      : undefined,
  });
  if (bridgeContext) a2a.message.bridgeContext = bridgeContext;

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
      piBridgeContext: bridgeContext,
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
        ...bridgePromptLines(bridgeContext || {}),
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
    const swarmCellOutput = normalizeSwarmCellOutput({
      taskOutput: output,
      evolutionOutput: output.evolutionOutput || output.evolution || {},
    });
    const swarmCellContract = validateSwarmCellContract({
      taskOutput: output,
      evolutionOutput: output.evolutionOutput || output.evolution || {},
    });
    const contractValid = missingFields.length === 0 && swarmCellContract.valid;

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
      status: contractValid ? 'completed' : 'contract_failed',
      output,
      taskOutput: swarmCellOutput.taskOutput,
      evolutionOutput: swarmCellOutput.evolutionOutput,
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
        reasons: swarmCellContract.reasons,
        valid: Boolean(contractValid),
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
      taskOutput: null,
      evolutionOutput: normalizeEvolutionOutput({}),
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
        reasons: ['pi_native_worker_failed'],
        valid: false,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } finally {
    await stopWorker(worker);
  }
}
