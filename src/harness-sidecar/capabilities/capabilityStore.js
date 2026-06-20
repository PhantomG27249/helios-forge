import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const registryWriteChains = new Map();

const SUPPORTED_TYPES = ['skill', 'mcp', 'pi_extension', 'profile', 'template', 'slash_command'];
const LOCAL_PATH_FIELDS = ['path', 'folder', 'file'];
const REDACTED = '[redacted]';

function getRegistryPath(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.join(workspaceRoot, '.harness', 'capabilities.json');
}

function getRuntimeManifestPath(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.join(workspaceRoot, '.harness', 'runtime', 'capabilities.mount.json');
}

function createEmptyRegistry() {
  return {
    version: 1,
    capabilities: [],
    byType: Object.fromEntries(SUPPORTED_TYPES.map((type) => [type, []])),
    counts: {
      skill: 0,
      mcp: 0,
      pi_extension: 0,
      profile: 0,
      template: 0,
      slash_command: 0,
      enabled: 0,
    },
  };
}

function normalizeType(type) {
  const normalized = String(type || '').trim().toLowerCase().replace(/-/g, '_');
  if (!SUPPORTED_TYPES.includes(normalized)) {
    throw new Error(`Unsupported capability type: ${type || '(empty)'}`);
  }
  return normalized;
}

function isInsideWorkspace(workspaceRoot, candidatePath) {
  const relative = path.relative(workspaceRoot, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeLocalPath({ workspaceRoot, value, field }) {
  if (value === undefined || value === null || value === '') return value;
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedPath = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(resolvedWorkspace, value);

  if (!isInsideWorkspace(resolvedWorkspace, resolvedPath)) {
    throw new Error(`Capability ${field} points outside workspace`);
  }
  return resolvedPath;
}

function isSecretLikeEnv(key, value) {
  if (/token|secret|password|passwd|api[_-]?key|credential|private/i.test(key)) {
    return true;
  }
  return typeof value === 'string' && /^(sk-|ghp_|gho_|xox[baprs]-)/i.test(value);
}

function normalizeEnv(env = {}) {
  return Object.fromEntries(
    Object.entries(env || {}).map(([key, value]) => [
      key,
      isSecretLikeEnv(key, value) ? REDACTED : value,
    ]),
  );
}

function normalizeArgs(args = []) {
  if (Array.isArray(args)) return args.filter((arg) => arg !== undefined && arg !== null);
  if (args === undefined || args === null || args === '') return [];
  return [args];
}

function normalizeRecord({ workspaceRoot, record }) {
  if (!record || typeof record !== 'object') throw new Error('record is required');
  const id = String(record.id || record.capabilityId || '').trim();
  if (!id) throw new Error('record.id is required');

  const normalized = {
    ...record,
    id,
    type: normalizeType(record.type),
    name: String(record.name || id).trim(),
    enabled: record.enabled === true,
    args: normalizeArgs(record.args),
    env: normalizeEnv(record.env),
    approvalMode: record.approvalMode || 'prompt',
    notes: record.notes || '',
    metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
  };

  for (const field of LOCAL_PATH_FIELDS) {
    if (field in normalized) {
      normalized[field] = normalizeLocalPath({
        workspaceRoot,
        value: normalized[field],
        field,
      });
    }
  }

  return normalized;
}

function decorateRegistry(registry) {
  const empty = createEmptyRegistry();
  const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];
  const decorated = {
    ...empty,
    version: Number(registry?.version || 1),
    capabilities,
  };

  for (const capability of capabilities) {
    if (!SUPPORTED_TYPES.includes(capability.type)) continue;
    decorated.byType[capability.type].push(capability);
    decorated.counts[capability.type] += 1;
    if (capability.enabled === true) decorated.counts.enabled += 1;
  }

  return decorated;
}

function policyMetadata(policy) {
  if (!policy) return undefined;
  return {
    policyId: policy.policyId,
    status: policy.status || 'shadow_only',
    mode: 'metadata_only',
  };
}

function parseRegistryJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const positionMatch = error.message.match(/position (\d+)/i);
    if (!positionMatch || !/after json/i.test(error.message)) {
      throw error;
    }
    const trimmed = raw.slice(0, Number(positionMatch[1])).trimEnd();
    if (!trimmed) throw error;
    return JSON.parse(trimmed);
  }
}

function withRegistryWriteLock(workspaceRoot, operation) {
  const key = path.resolve(workspaceRoot);
  const previous = registryWriteChains.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  registryWriteChains.set(key, next);
  return next.finally(() => {
    if (registryWriteChains.get(key) === next) {
      registryWriteChains.delete(key);
    }
  });
}

async function readStoredRegistry(workspaceRoot) {
  const registryPath = getRegistryPath(workspaceRoot);
  try {
    const raw = await readFile(registryPath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      const repaired = parseRegistryJson(raw);
      await writeRegistry({ workspaceRoot, registry: repaired });
      return repaired;
    }
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyRegistry();
    throw error;
  }
}

async function writeRegistry({ workspaceRoot, registry }) {
  const registryPath = getRegistryPath(workspaceRoot);
  await mkdir(path.dirname(registryPath), { recursive: true });
  const stored = {
    version: registry.version || 1,
    capabilities: registry.capabilities || [],
  };
  const content = `${JSON.stringify(stored, null, 2)}\n`;
  const tempPath = `${registryPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, registryPath);
  return decorateRegistry(stored);
}

export async function loadCapabilityRegistry({ workspaceRoot } = {}) {
  return decorateRegistry(await readStoredRegistry(workspaceRoot));
}

export async function saveCapabilityRecords({ workspaceRoot, records, version } = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  if (!Array.isArray(records)) throw new Error('records must be an array');

  return withRegistryWriteLock(workspaceRoot, async () => {
    const normalized = records.map((record) => normalizeRecord({ workspaceRoot, record }));
    const registry = await loadCapabilityRegistry({ workspaceRoot });
    const capabilities = [...registry.capabilities];

    for (const record of normalized) {
      const existingIndex = capabilities.findIndex((capability) => capability.id === record.id);
      if (existingIndex >= 0) {
        capabilities[existingIndex] = record;
      } else {
        capabilities.push(record);
      }
    }

    await writeRegistry({
      workspaceRoot,
      registry: {
        version: version ?? registry.version,
        capabilities,
      },
    });
    return normalized;
  });
}

export async function saveCapabilityRecord({ workspaceRoot, record } = {}) {
  const [saved] = await saveCapabilityRecords({ workspaceRoot, records: [record] });
  return saved;
}

export async function deleteCapabilityRecord({ workspaceRoot, capabilityId } = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  return withRegistryWriteLock(workspaceRoot, async () => {
    const registry = await loadCapabilityRegistry({ workspaceRoot });
    const capabilities = registry.capabilities.filter((capability) => capability.id !== capabilityId);
    return writeRegistry({
      workspaceRoot,
      registry: {
        version: registry.version,
        capabilities,
      },
    });
  });
}

export async function buildRuntimeMountManifest({ workspaceRoot, profileId = null, trustPolicy = null } = {}) {
  const registry = await loadCapabilityRegistry({ workspaceRoot });
  const capabilities = registry.capabilities.filter((capability) => capability.enabled === true);
  const manifestPath = getRuntimeManifestPath(workspaceRoot);
  const manifest = decorateRegistry({
    version: registry.version,
    capabilities,
  });
  const runtimeManifest = {
    version: manifest.version,
    profileId,
    manifestPath,
    capabilities: manifest.capabilities,
    byType: manifest.byType,
    counts: manifest.counts,
  };
  if (trustPolicy) {
    runtimeManifest.trustPolicy = policyMetadata(trustPolicy);
  }

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');
  return runtimeManifest;
}
