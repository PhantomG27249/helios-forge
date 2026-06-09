const SMITHERY_API_BASE = 'https://api.smithery.ai';
const SMITHERY_SERVER_BASE = 'https://server.smithery.ai';
const SMITHERY_SKILL_BASE = 'https://smithery.ai/skills';

function normalizeString(value) {
  return String(value || '').trim();
}

function slugPart(value) {
  return normalizeString(value)
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeQualifiedName(value) {
  return normalizeString(value)
    .replace(/^@/, '')
    .replace(/^\/+|\/+$/g, '');
}

function safeUrl(value) {
  try {
    return new URL(normalizeString(value));
  } catch {
    return null;
  }
}

function smitherySkillUrlFromQualifiedName(qualifiedName) {
  const clean = normalizeQualifiedName(qualifiedName);
  if (!clean) return '';
  return `${SMITHERY_SKILL_BASE}/${clean}`;
}

function skillQualifiedNameFromInput(input) {
  const text = normalizeString(input);
  const urlMatch = text.match(/https?:\/\/smithery\.ai\/skills\/[^\s"'<>]+/i);
  const raw = urlMatch?.[0] || text;
  const parsed = safeUrl(raw);
  if (parsed?.hostname === 'smithery.ai') {
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const skillsIndex = parts.findIndex((part) => part.toLowerCase() === 'skills');
    if (skillsIndex >= 0 && parts.length >= skillsIndex + 3) {
      return `${parts[skillsIndex + 1]}/${parts[skillsIndex + 2]}`;
    }
  }
  const bareMatch = text.match(/(?:^|\s)(?:@?)([a-z0-9_.-]+\/[a-z0-9_.-]+)(?:\s|$)/i);
  return bareMatch ? bareMatch[1] : '';
}

function skillInstallUrlFromInput(input) {
  const text = normalizeString(input);
  const urlMatch = text.match(/https?:\/\/smithery\.ai\/skills\/[^\s"'<>]+/i);
  if (urlMatch) return urlMatch[0].replace(/[),.;]+$/g, '');
  return smitherySkillUrlFromQualifiedName(skillQualifiedNameFromInput(text));
}

function isSmitherySkillInput(input) {
  const text = normalizeString(input);
  return /(?:^|\s)skills\s+add\s+/i.test(text)
    || /https?:\/\/smithery\.ai\/skills\//i.test(text);
}

function mcpInstallUrlFromInput(input) {
  const text = normalizeString(input);
  const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) return urlMatch[0].replace(/[),.;]+$/g, '');
  return text ? `${SMITHERY_SERVER_BASE}/${normalizeQualifiedName(text)}` : '';
}

function mcpQualifiedNameFromUrl(input) {
  const url = mcpInstallUrlFromInput(input);
  const parsed = safeUrl(url);
  if (!parsed) return normalizeQualifiedName(input);
  const pathName = parsed.pathname.replace(/^\/+|\/+$/g, '');
  return pathName || parsed.hostname;
}

function installUrlFor(server = {}) {
  const explicit = normalizeString(server.installUrl || server.serverUrl || server.deploymentUrl || server.url);
  if (explicit) return explicit;
  const qualifiedName = normalizeQualifiedName(server.qualifiedName || server.name || server.id);
  if (!qualifiedName) return '';
  return `${SMITHERY_SERVER_BASE}/${qualifiedName}`;
}

function normalizeSmitheryServer(server = {}) {
  const qualifiedName = normalizeQualifiedName(server.qualifiedName || server.name || server.id);
  return {
    id: normalizeString(server.id || qualifiedName),
    kind: 'mcp',
    qualifiedName,
    displayName: normalizeString(server.displayName || server.name || qualifiedName),
    description: normalizeString(server.description),
    installUrl: installUrlFor(server),
    verified: server.verified === true,
    remote: server.remote !== false,
    useCount: Number.isFinite(Number(server.useCount)) ? Number(server.useCount) : 0,
    iconUrl: normalizeString(server.iconUrl),
    homepage: normalizeString(server.homepage),
  };
}

function normalizeSmitherySkill(skill = {}) {
  const namespace = normalizeString(skill.namespace || skill.owner || skill.organization);
  const slug = normalizeString(skill.slug || skill.name || skill.id);
  const qualifiedName = normalizeQualifiedName(
    skill.qualifiedName || skill.qualified_name || (namespace && slug ? `${namespace}/${slug}` : slug),
  );
  const installUrl = normalizeString(skill.installUrl || skill.url)
    || smitherySkillUrlFromQualifiedName(qualifiedName);
  const useCount = Number(
    skill.useCount ?? skill.totalActivations ?? skill.activations ?? skill.downloads ?? 0,
  );
  return {
    id: normalizeString(skill.id || qualifiedName),
    kind: 'skill',
    qualifiedName,
    displayName: normalizeString(skill.displayName || skill.title || qualifiedName),
    description: normalizeString(skill.description),
    installUrl,
    verified: skill.verified === true,
    remote: skill.remote !== false,
    useCount: Number.isFinite(useCount) ? useCount : 0,
    iconUrl: normalizeString(skill.iconUrl),
    homepage: normalizeString(skill.homepage),
  };
}

function extractSmitheryItems(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function fetchSmitheryCollection({ path, query, apiKey, pageSize, fetchImpl }) {
  const url = new URL(path, SMITHERY_API_BASE);
  url.searchParams.set('q', query);
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(25, Number(pageSize) || 8))));
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Smithery search failed: ${response.status}`);
  }
  return response.json();
}

export async function searchSmitheryServers({
  query,
  apiKey = process.env.SMITHERY_API_KEY,
  pageSize = 8,
  fetchImpl = globalThis.fetch,
} = {}) {
  const q = normalizeString(query);
  if (!q) return { results: [], query: q, source: 'smithery' };
  if (!apiKey) {
    return {
      results: [],
      query: q,
      source: 'smithery',
      error: 'SMITHERY_API_KEY is required for registry search',
    };
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  try {
    const payload = await fetchSmitheryCollection({
      path: '/servers',
      query: q,
      apiKey,
      pageSize,
      fetchImpl,
    });
    const servers = extractSmitheryItems(payload, ['servers']);
    return {
      results: servers.map(normalizeSmitheryServer),
      query: q,
      source: 'smithery',
    };
  } catch (error) {
    return {
      results: [],
      query: q,
      source: 'smithery',
      error: error.message,
    };
  }
}

export async function searchSmitheryCatalog({
  query,
  apiKey = process.env.SMITHERY_API_KEY,
  pageSize = 8,
  fetchImpl = globalThis.fetch,
} = {}) {
  const q = normalizeString(query);
  if (!q) return { results: [], query: q, source: 'smithery' };
  if (!apiKey) {
    return {
      results: [],
      query: q,
      source: 'smithery',
      error: 'SMITHERY_API_KEY is required for registry search',
    };
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  try {
    const [skillsPayload, serversPayload] = await Promise.all([
      fetchSmitheryCollection({ path: '/skills', query: q, apiKey, pageSize, fetchImpl }),
      fetchSmitheryCollection({ path: '/servers', query: q, apiKey, pageSize, fetchImpl }),
    ]);
    const skills = extractSmitheryItems(skillsPayload, ['skills']).map(normalizeSmitherySkill);
    const servers = extractSmitheryItems(serversPayload, ['servers']).map(normalizeSmitheryServer);
    return {
      results: [...skills, ...servers],
      query: q,
      source: 'smithery',
    };
  } catch (error) {
    return {
      results: [],
      query: q,
      source: 'smithery',
      error: error.message,
    };
  }
}

export function buildSmitherySkillCapabilityRecord(skill = {}) {
  const normalized = normalizeSmitherySkill(skill);
  const qualifiedName = normalized.qualifiedName || skillQualifiedNameFromInput(normalized.installUrl);
  const installUrl = normalized.installUrl || smitherySkillUrlFromQualifiedName(qualifiedName);
  return {
    id: `smithery:skill:${slugPart(qualifiedName) || 'skill'}`,
    type: 'skill',
    name: qualifiedName || normalized.displayName || 'Smithery Skill',
    enabled: true,
    url: installUrl,
    pathOrCommandOrUrl: installUrl,
    command: 'npx',
    args: ['-y', 'skills', 'add', installUrl],
    approvalMode: 'inherit',
    notes: normalized.description || 'Installed from Smithery skill link.',
    metadata: {
      source: 'smithery',
      kind: 'skill',
      qualifiedName,
      verified: normalized.verified,
      remote: normalized.remote,
      useCount: normalized.useCount,
      homepage: normalized.homepage,
      installCommand: `npx -y skills add ${installUrl}`,
    },
  };
}

export function buildSmitheryCapabilityRecord(server = {}) {
  const normalized = normalizeSmitheryServer(server);
  const qualifiedName = normalized.qualifiedName || normalized.displayName || normalized.id;
  const idSuffix = slugPart(qualifiedName) || 'server';
  return {
    id: `smithery:mcp:${idSuffix}`,
    type: 'mcp',
    name: normalized.displayName || qualifiedName,
    enabled: true,
    transport: 'http',
    url: normalized.installUrl,
    pathOrCommandOrUrl: normalized.installUrl,
    approvalMode: 'inherit',
    notes: normalized.description,
    metadata: {
      source: 'smithery',
      kind: 'mcp',
      qualifiedName,
      verified: normalized.verified,
      remote: normalized.remote,
      useCount: normalized.useCount,
      homepage: normalized.homepage,
    },
  };
}

export function buildCapabilityRecordFromSmitheryInstallInput(input) {
  const text = normalizeString(input);
  if (!text) return null;

  if (isSmitherySkillInput(text)) {
    const qualifiedName = skillQualifiedNameFromInput(text);
    const installUrl = skillInstallUrlFromInput(text);
    return buildSmitherySkillCapabilityRecord({
      qualifiedName,
      installUrl,
      description: 'Installed from Smithery skill link.',
    });
  }

  const installUrl = mcpInstallUrlFromInput(text);
  const qualifiedName = mcpQualifiedNameFromUrl(installUrl);
  return buildSmitheryCapabilityRecord({
    qualifiedName,
    displayName: qualifiedName,
    installUrl,
    description: 'Installed from Smithery MCP URL.',
  });
}
