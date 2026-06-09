import { PiRpcManager } from '../../pi/piRpcManager.js';
import { buildSwarmA2AEnvelope } from '../interop/a2aSwarmEnvelope.js';
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

function inferPatchStats(output = {}) {
  if (output.patchStats) return output.patchStats;
  if (typeof output.patch !== 'string') return { changedLines: 0 };
  const changedLines = output.patch
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---'))
    .length;
  return { changedLines };
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

function responsePayload(response = {}) {
  return response.data || response.output || response.structured || response;
}

function normalizeOutput(payload = {}) {
  if (typeof payload === 'string') {
    return { summary: payload, verifierEvidence: [] };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { summary: 'Pi-native worker returned no structured output.', verifierEvidence: [] };
  }
  return {
    ...payload,
    verifierEvidence: asArray(payload.verifierEvidence),
    verifierCommands: asArray(payload.verifierCommands),
    artifacts: asArray(payload.artifacts),
    risks: asArray(payload.risks),
  };
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
        'Return a compact JSON handoff with summary, verifierEvidence, compactHandoff, optional patch, optional thinkingSummary.',
      ].join('\n'),
      a2a,
      streamingBehavior: 'block_until_done',
    });
    const output = normalizeOutput(responsePayload(response));
    const compactHandoff = normalizeCompactHandoff(output);
    const handoffQuality = scoreCompactHandoff(compactHandoff);
    const verifierEvidence = output.verifierEvidence || [];
    const valid = output.summary && hasVerifierEvidence(verifierEvidence);

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
        requiredFields: outputContract.requiredFields || [],
        missingFields: valid ? [] : (outputContract.requiredFields || []),
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
