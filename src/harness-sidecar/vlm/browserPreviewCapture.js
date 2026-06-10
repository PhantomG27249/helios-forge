import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  assertBrowserUrlAllowed,
  createBrowserPolicy,
  sanitizeUrlForBrowserTrace,
} from '../browser/browserPolicy.js';

function isUnderRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function visualTaskDir({ workspaceRoot, taskId }) {
  return path.join(workspaceRoot, '.harness', 'visual', taskId);
}

const SENSITIVE_HEADER_PATTERN = /(^|[-_])(authorization|cookie|set-cookie|api-key|token|secret|session)([-_]|$)/i;
const MAX_EVIDENCE_ITEMS = 20;
const MAX_EVIDENCE_TEXT_LENGTH = 500;

function isRawPayloadField(key = '') {
  return /body$/i.test(key)
    || /html$/i.test(key)
    || /content$/i.test(key)
    || /^dataUrl$/i.test(key)
    || /^bytes$/i.test(key)
    || /^buffer$/i.test(key)
    || /^raw/i.test(key);
}

function boundedText(value, maxLength = MAX_EVIDENCE_TEXT_LENGTH) {
  if (value === undefined || value === null) return value;
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function sanitizeUrl(value) {
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

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    SENSITIVE_HEADER_PATTERN.test(key) ? '[redacted]' : boundedText(value, 200),
  ]));
}

function sanitizeEvidenceValue(value, key = '') {
  if (value === undefined || value === null) return value;
  if (isRawPayloadField(key)) return undefined;
  if (/url$/i.test(key)) return sanitizeUrl(value);
  if (/headers$/i.test(key)) return sanitizeHeaders(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_EVIDENCE_ITEMS)
      .map((item) => sanitizeEvidenceValue(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([nestedKey, nestedValue]) => [nestedKey, sanitizeEvidenceValue(nestedValue, nestedKey)])
      .filter(([, nestedValue]) => nestedValue !== undefined));
  }
  if (typeof value === 'string') return boundedText(value);
  return value;
}

function normalizeEvidenceArray(...values) {
  return values.flatMap((value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }).slice(0, MAX_EVIDENCE_ITEMS);
}

function extractArtifactPath(artifacts, type) {
  if (!Array.isArray(artifacts)) return null;
  const match = artifacts.find((artifact) => artifact?.type === type || artifact?.kind === type);
  return match?.path || match?.artifactPath || null;
}

export function sanitizeBrowserEvidenceMetadata(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const consoleErrors = normalizeEvidenceArray(
    evidence.consoleErrors,
    evidence.console?.errors,
    evidence.console?.consoleErrors,
  ).map((item) => sanitizeEvidenceValue(item)).filter(Boolean);
  const failedRequests = normalizeEvidenceArray(
    evidence.failedRequests,
    evidence.network?.failedRequests,
    evidence.network?.failures,
  ).map((item) => sanitizeEvidenceValue(item)).filter(Boolean);
  const networkSummary = normalizeEvidenceArray(
    evidence.networkSummary,
    evidence.network?.summary,
    evidence.network?.requests,
  ).map((item) => sanitizeEvidenceValue(item)).filter(Boolean);
  const domSnapshotPath = evidence.domSnapshotPath
    || evidence.domSnapshot?.path
    || extractArtifactPath(evidence.artifacts, 'dom_snapshot')
    || null;

  return {
    consoleErrors,
    failedRequests,
    networkSummary,
    domSnapshotPath,
  };
}

function resolveArtifactPath({ workspaceRoot, taskId, targetPath, defaultName, label }) {
  const taskDir = visualTaskDir({ workspaceRoot, taskId });
  const resolved = targetPath
    ? path.resolve(taskDir, targetPath)
    : path.join(taskDir, defaultName);

  if (!isUnderRoot(workspaceRoot, resolved)) {
    throw new Error(`${label} must stay inside workspace`);
  }
  if (!isUnderRoot(taskDir, resolved)) {
    throw new Error(`${label} must stay inside workspace visual task directory`);
  }
  return resolved;
}

export function validateBrowserPreviewUrl({
  url,
  browserPolicy,
  reason = 'browser_preview_capture',
} = {}) {
  try {
    assertBrowserUrlAllowed({
      url,
      policy: browserPolicy || createBrowserPolicy(),
      reason,
    });
    return { allowed: true };
  } catch (error) {
    return {
      allowed: false,
      status: 'denied',
      kind: 'policy',
      reason: error?.causeCode || error?.reason || error?.code || 'browser_url_policy_denied',
      url: error?.url || sanitizeUrlForBrowserTrace(url),
      message: error?.message,
    };
  }
}

export async function captureBrowserPreview({
  taskId,
  workspaceRoot,
  url,
  outputPath,
  browserRuntime,
  browserPolicy,
} = {}) {
  if (!browserRuntime || typeof browserRuntime.capture !== 'function') {
    return { status: 'unavailable', reason: 'browser_runtime_required' };
  }
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }
  if (!taskId) {
    throw new Error('taskId is required');
  }

  const policyResult = validateBrowserPreviewUrl({
    url,
    browserPolicy,
    reason: 'captureBrowserPreview',
  });
  if (!policyResult.allowed) {
    return policyResult;
  }

  const resolvedOutputPath = resolveArtifactPath({
    workspaceRoot,
    taskId,
    targetPath: outputPath,
    defaultName: 'web-preview.png',
    label: 'outputPath',
  });
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });

  const captured = await browserRuntime.capture({ url, outputPath: resolvedOutputPath, taskId });
  const imagePath = captured?.imagePath || resolvedOutputPath;
  if (!isUnderRoot(visualTaskDir({ workspaceRoot, taskId }), imagePath)) {
    throw new Error('imagePath must stay inside .harness/visual task directory');
  }
  const browserEvidence = sanitizeBrowserEvidenceMetadata(captured?.browserEvidence || captured?.evidence);

  const result = {
    status: 'captured',
    imagePath: path.resolve(imagePath),
    width: captured?.width || captured?.viewport?.width || 0,
    height: captured?.height || captured?.viewport?.height || 0,
    viewport: captured?.viewport,
  };
  if (browserEvidence) {
    result.browserEvidence = browserEvidence;
  }
  return result;
}
