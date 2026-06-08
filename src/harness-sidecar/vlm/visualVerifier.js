import path from 'node:path';

import { buildMultimodalRequest } from '../model/multimodalRequestBuilder.js';
import { repairJsonObject } from '../model/structuredOutputRepair.js';
import { readImageArtifact } from './imageIO.js';
import { captureProductionVisualArtifacts } from './productionArtifactCapture.js';
import { createVisualVerifierRubric } from './visualVerifierRubric.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function emitMaybe(emitEvent, event) {
  if (typeof emitEvent === 'function') {
    await emitEvent(event);
  }
}

function artifactList(captureResult = {}) {
  return [
    captureResult.artifacts?.screenshot,
    ...asArray(captureResult.artifacts?.pdfPages),
    captureResult.artifacts?.visualDiff,
  ].filter(Boolean);
}

function visualPathsForArtifact(artifact) {
  if (!artifact?.artifacts || typeof artifact.artifacts !== 'object') return [];
  const preferred = [
    artifact.artifacts.image,
    artifact.artifacts.diff,
    artifact.artifacts.before,
    artifact.artifacts.after,
  ];
  return [...new Set(preferred.filter(Boolean))];
}

function relativePathIfInside(workspaceRoot, value) {
  if (typeof value !== 'string' || !value.trim()) return value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (!path.isAbsolute(value)) return value.replace(/\\/g, '/');
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedValue = path.resolve(value);
  const relative = path.relative(resolvedRoot, resolvedValue);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return value;
  return relative.replace(/\\/g, '/');
}

function sanitizeArtifactPaths(value, workspaceRoot) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeArtifactPaths(item, workspaceRoot));
  }
  if (!value || typeof value !== 'object') {
    return relativePathIfInside(workspaceRoot, value);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === 'ocrText' ? undefined : sanitizeArtifactPaths(item, workspaceRoot),
  ]).filter(([, item]) => item !== undefined));
}

function artifactMetadata(artifact, workspaceRoot) {
  return {
    artifactId: artifact.artifactId,
    taskId: artifact.taskId,
    type: artifact.type,
    summary: artifact.summary,
    artifacts: sanitizeArtifactPaths(artifact.artifacts, workspaceRoot),
    metadata: sanitizeArtifactPaths(artifact.metadata, workspaceRoot),
    visualContext: artifact.visualContext,
  };
}

function parseJudgePayload(response) {
  if (response?.structured !== undefined && response.structured !== null) return response.structured;
  const payload = response?.output ?? response?.text ?? response?.content ?? response;
  if (typeof payload === 'string') {
    return repairJsonObject(payload);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Malformed visual verifier output: expected JSON object');
  }
  return payload;
}

function normalizeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(0, Math.min(1, normalized));
}

function normalizeFindings(findings) {
  return asArray(findings)
    .map((finding) => {
      if (typeof finding === 'string') {
        const message = finding.trim();
        return message ? { severity: 'info', message } : null;
      }
      if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return null;
      const message = String(finding.message || finding.text || finding.description || '').trim();
      if (!message) return null;
      return {
        severity: finding.severity || 'info',
        message,
      };
    })
    .filter(Boolean);
}

function modelFromResponse(response, payload) {
  return payload?.model
    || response?.model
    || (response?.profile ? { profileName: response.profile.name || null, model: response.profile.model || null } : null)
    || null;
}

function redactUrlForTrace(value) {
  if (!value) return value;
  try {
    const url = new URL(String(value));
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid-url]';
  }
}

function normalizeVerifierOutput({ response, rubric }) {
  const payload = parseJudgePayload(response);
  const score = normalizeNumber(payload.score, 0);
  const confidence = normalizeNumber(payload.confidence, 0);
  const modelPassed = typeof payload.passed === 'boolean' ? payload.passed : null;
  const passed = score >= rubric.passThreshold && confidence >= rubric.confidenceThreshold;

  return {
    name: 'visual.verifier',
    passed,
    modelPassed,
    score,
    confidence,
    findings: normalizeFindings(payload.findings),
    rubricVersion: rubric.rubricVersion,
    model: modelFromResponse(response, payload),
    usage: response?.usage || payload.usage || null,
  };
}

async function loadImageInputs({ artifacts, workspaceRoot, artifactRoots }) {
  const paths = artifacts.flatMap(visualPathsForArtifact);
  const images = [];
  for (const imagePath of paths) {
    try {
      images.push(await readImageArtifact({ imagePath, workspaceRoot, artifactRoots }));
    } catch {
      // Non-image related artifact paths are metadata only and should not block judging.
    }
  }
  return images.map((image, index) => ({
    artifactId: `visual_${index + 1}`,
    path: image.path,
    mimeType: image.mimeType,
    dataUrl: image.dataUrl,
    metadata: image.metadata,
  }));
}

function buildGatewayInput({ taskId, rubric, artifactMetadataItems, imageInputs }) {
  const visualItems = imageInputs.map((image) => ({
    artifactId: image.artifactId,
    type: 'image_artifact',
    artifact: {
      type: 'image_artifact',
      path: image.path,
      mimeType: image.mimeType,
      metadata: image.metadata,
    },
  }));
  const request = buildMultimodalRequest({
    profileName: 'qwen36_vlm_fast',
    prompt: rubric.prompt,
    visualItems,
  });
  const imageByPath = new Map(imageInputs.map((image) => [image.path, image]));
  const messages = request.messages.map((message) => ({
    ...message,
    content: message.content.map((part) => {
      if (part.type !== 'image_reference') return part;
      const image = imageByPath.get(part.path);
      return image
        ? {
          type: 'image_url',
          artifactId: part.artifactId,
          kind: part.kind,
          image_url: { url: image.dataUrl },
          metadata: image.metadata,
        }
        : part;
    }),
  }));

  return {
    taskId,
    purpose: 'visual_verifier',
    profileName: 'qwen36_vlm_fast',
    messages,
    structuredOutput: true,
    visionInputs: imageInputs,
    artifacts: artifactMetadataItems,
    rubric: {
      rubricVersion: rubric.rubricVersion,
      strictness: rubric.strictness,
      expected: rubric.expected,
      passThreshold: rubric.passThreshold,
      confidenceThreshold: rubric.confidenceThreshold,
    },
    tokensEstimated: request.tokensEstimated,
  };
}

async function callModelGateway({ modelGateway, callInput }) {
  if (modelGateway?.call) return modelGateway.call(callInput);
  if (typeof modelGateway === 'function') return modelGateway(callInput);
  throw new Error('visual verifier requires an injected vlmJudge or modelGateway');
}

export async function runVisualVerifier({
  taskId,
  workspaceRoot,
  goal,
  expected = [],
  targetUrl,
  beforePath,
  afterPath,
  captureAdapter,
  workerRuntimes,
  modelGateway,
  vlmJudge,
  emitEvent = () => {},
  strictness = 'balanced',
} = {}) {
  if (!taskId) {
    throw new Error('taskId is required');
  }
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }
  if (!goal) {
    throw new Error('goal is required');
  }

  const startedAt = Date.now();
  const redactedTargetUrl = redactUrlForTrace(targetUrl);
  await emitMaybe(emitEvent, {
    type: 'visual_verifier.started',
    taskId,
    goal,
    targetUrl: redactedTargetUrl,
    hasBeforePath: Boolean(beforePath),
    hasAfterPath: Boolean(afterPath),
  });

  try {
    const captureResult = await captureProductionVisualArtifacts({
      taskId,
      workspaceRoot,
      targetUrl,
      beforePath,
      afterPath,
      captureAdapter,
      workerRuntimes,
      emitEvent,
    });
    const artifacts = artifactList(captureResult);
    const artifactMetadataItems = artifacts.map((artifact) => artifactMetadata(artifact, workspaceRoot));
    const artifactRoots = [captureResult.outputDir].filter(Boolean);
    const imageInputs = await loadImageInputs({ artifacts, workspaceRoot, artifactRoots });

    await emitMaybe(emitEvent, {
      type: 'visual_verifier.artifacts_captured',
      taskId,
      artifactCount: artifacts.length,
      artifactIds: artifactMetadataItems.map((artifact) => artifact.artifactId),
      imageInputCount: imageInputs.length,
      skipped: captureResult.skipped || [],
    });

    if (artifacts.length === 0 || imageInputs.length === 0) {
      const result = {
        name: 'visual.verifier',
        passed: false,
        score: 0,
        confidence: 0,
        findings: [{ severity: 'error', message: 'No visual artifact was available to judge.' }],
        artifacts: [],
        rubricVersion: 1,
        model: null,
        reason: 'visual_artifact_unavailable',
        durationMs: Date.now() - startedAt,
      };
      await emitMaybe(emitEvent, {
        type: 'visual_verifier.failed',
        taskId,
        reason: result.reason,
        artifactCount: artifacts.length,
        imageInputCount: imageInputs.length,
      });
      return result;
    }

    const rubric = createVisualVerifierRubric({
      goal,
      expected,
      artifactTypes: artifacts.map((artifact) => artifact.type),
      strictness,
    });
    const response = typeof vlmJudge === 'function'
      ? await vlmJudge({ taskId, goal, expected: asArray(expected), rubric, artifacts: artifactMetadataItems, imageInputs })
      : await callModelGateway({
        modelGateway,
        callInput: buildGatewayInput({ taskId, rubric, artifactMetadataItems, imageInputs }),
      });

    const result = {
      ...normalizeVerifierOutput({ response, rubric }),
      artifacts: artifactMetadataItems,
      durationMs: Date.now() - startedAt,
    };
    await emitMaybe(emitEvent, {
      type: 'visual_verifier.completed',
      taskId,
      passed: result.passed,
      score: result.score,
      confidence: result.confidence,
      artifactCount: result.artifacts.length,
      findingCount: result.findings.length,
      model: result.model,
      durationMs: result.durationMs,
    });
    return result;
  } catch (error) {
    await emitMaybe(emitEvent, {
      type: 'visual_verifier.failed',
      taskId,
      reason: error.message,
    });
    throw error;
  }
}
