import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const TELEMETRY_REL = '.harness/meta/pi-bridge-telemetry.jsonl';
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function resolveRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function telemetryPath(workspaceRoot) {
  return path.join(resolveRoot(workspaceRoot), TELEMETRY_REL);
}

export async function recordManifestConsumed({
  workspaceRoot,
  manifestId = null,
  source = 'helios-forge-extension',
  now = () => new Date(),
} = {}) {
  const filePath = telemetryPath(workspaceRoot);
  const record = {
    type: 'manifest_consumed',
    manifestId,
    source,
    recordedAt: (typeof now === 'function' ? now() : now).toISOString(),
    evidenceOnly: true,
    canPromote: false,
  };
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function loadRecentPiBridgeTelemetry({
  workspaceRoot,
  now = () => new Date(),
  windowMs = RECENT_WINDOW_MS,
} = {}) {
  const filePath = telemetryPath(workspaceRoot);
  const cutoff = (typeof now === 'function' ? now() : new Date(now)).getTime() - windowMs;
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => {
      const ts = new Date(entry.recordedAt || 0).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function buildPiBridgeHealthFromTelemetry({
  workspaceRoot,
  now = () => new Date(),
} = {}) {
  const recent = await loadRecentPiBridgeTelemetry({ workspaceRoot, now });
  const consumed = recent.some((entry) => entry.type === 'manifest_consumed');
  const latest = recent.length ? recent[recent.length - 1] : null;
  return {
    manifestConsumedByPi: consumed,
    latestTelemetry: latest,
    recentEventCount: recent.length,
    evidenceOnly: true,
    canPromote: false,
  };
}
