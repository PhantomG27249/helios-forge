const SMITHERY_API_BASE = 'https://api.smithery.ai';
const SMITHERY_SERVER_BASE = 'https://server.smithery.ai';
const SMITHERY_SKILL_BASE = 'https://smithery.ai/skills';
const CODEX_SKILL_BASE = 'https://codex.openai.com/marketplace/skills';

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

function commandTokens(input) {
  return Array.from(normalizeString(input).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g))
    .map((match) => match[1] || match[2] || match[3])
    .filter(Boolean);
}

function firstUrlFromInput(input) {
  const match = normalizeString(input).match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0].replace(/[),.;]+$/g, '') : '';
}

function displayNameFromLocation(value) {
  const text = normalizeString(value);
  const parsed = safeUrl(text);
  const raw = parsed ? parsed.pathname : text;
  const parts = raw.replace(/^\/+|\/+$/g, '').split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || parsed?.hostname || text || 'capability';
}

function isSmitherySkillInput(input) {
  const text = normalizeString(input);
  return /(?:^|\s)skills\s+add\s+/i.test(text)
    || /https?:\/\/smithery\.ai\/skills\//i.test(text);
}

function codexSkillQualifiedNameFromInput(input) {
  const text = normalizeString(input);
  const urlMatch = text.match(/https?:\/\/codex\.openai\.com\/marketplace\/skills\/[^\s"'<>]+/i);
  const parsed = safeUrl(urlMatch?.[0] || text);
  if (parsed?.hostname === 'codex.openai.com') {
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const skillsIndex = parts.findIndex((part) => part.toLowerCase() === 'skills');
    if (skillsIndex >= 0 && parts.length >= skillsIndex + 3) {
      return `${parts[skillsIndex + 1]}/${parts[skillsIndex + 2]}`;
    }
  }
  const bareMatch = text.match(/(?:^|\s)@?([a-z0-9_.-]+\/[a-z0-9_.-]+)(?:\s|$)/i);
  return bareMatch ? bareMatch[1] : '';
}

function codexSkillUrlFromInput(input) {
  const url = firstUrlFromInput(input);
  if (/^https?:\/\/codex\.openai\.com\/marketplace\/skills\//i.test(url)) return url;
  const qualifiedName = codexSkillQualifiedNameFromInput(input);
  return qualifiedName ? `${CODEX_SKILL_BASE}/${qualifiedName}` : '';
}

function isCodexSkillInput(input) {
  const text = normalizeString(input);
  return /https?:\/\/codex\.openai\.com\/marketplace\/skills\//i.test(text)
    || /(?:^|\s)codex\s+skills?\s+add\s+/i.test(text);
}

function isCodexPluginInput(input) {
  const text = normalizeString(input);
  return /^codex:\/\/plugins\/[^?\s]+/i.test(text)
    || /(?:^|\s)codex\s+plugin\s+(?:install|marketplace\s+add)\s+/i.test(text);
}

function isClaudeInput(input) {
  const text = normalizeString(input);
  return /(?:^|\s)claude\s+(?:skill|skills|mcp)\s+add\s+/i.test(text)
    || /(?:^|\s)claude\s+plugin\s+(?:install|marketplace\s+add)\s+/i.test(text)
    || /https?:\/\/(?:www\.)?(?:anthropic\.com|claude\.ai)\/[^\s"'<>]*(?:skill|mcp|marketplace)/i.test(text);
}

function isPiExtensionInput(input) {
  const text = normalizeString(input);
  return /(?:^|\s)pi(?:\.cmd|\.ps1)?\s+(?:extension|extensions)\s+add\s+/i.test(text)
    || /(?:^|\s)pi-agent\s+(?:extension|extensions)\s+add\s+/i.test(text)
    || /(?:^|[\\/])\.pi[\\/]agent[\\/]extensions[\\/]/i.test(text);
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

export function buildCodexSkillCapabilityRecord(input) {
  const installUrl = codexSkillUrlFromInput(input);
  const qualifiedName = codexSkillQualifiedNameFromInput(input) || displayNameFromLocation(installUrl);
  return {
    id: `codex:skill:${slugPart(qualifiedName) || 'skill'}`,
    type: 'skill',
    name: qualifiedName,
    enabled: true,
    url: installUrl,
    pathOrCommandOrUrl: installUrl,
    command: 'npx',
    args: ['-y', 'codex', 'skills', 'add', installUrl],
    approvalMode: 'inherit',
    notes: 'Installed from Codex marketplace skill link.',
    metadata: {
      source: 'codex_marketplace',
      kind: 'skill',
      qualifiedName,
      installCommand: `npx -y codex skills add ${installUrl}`,
    },
  };
}

export function buildCodexPluginCapabilityRecord(input) {
  const text = normalizeString(input);
  const parsed = safeUrl(text);
  const pluginRef = parsed?.protocol === 'codex:' && parsed.hostname === 'plugins'
    ? parsed.pathname.replace(/^\/+|\/+$/g, '')
    : commandTokens(text).at(-1);
  const [pluginName = pluginRef || 'plugin', marketplace = 'default'] = normalizeString(pluginRef).split('@');
  const location = parsed?.protocol === 'codex:' ? text : `codex://plugins/${pluginName}@${marketplace}`;
  return {
    id: `codex:plugin:${slugPart(`${pluginName}-${marketplace}`) || 'plugin'}`,
    type: 'skill',
    name: `${pluginName}@${marketplace}`,
    enabled: true,
    url: location,
    pathOrCommandOrUrl: location,
    approvalMode: 'inherit',
    notes: 'Install/use Codex plugin from the Codex marketplace.',
    metadata: {
      source: 'codex_marketplace',
      kind: 'plugin',
      pluginName,
      marketplace,
      installSurface: 'codex_app',
      deepLink: location,
    },
  };
}

export function buildClaudeCapabilityRecord(input) {
  const tokens = commandTokens(input);
  const commandIndex = tokens.findIndex((token) => token.toLowerCase() === 'claude');
  const commandArgs = commandIndex >= 0 ? tokens.slice(commandIndex + 1) : [];
  const mode = commandArgs[0]?.toLowerCase();
  if (mode === 'plugin') {
    const pluginRef = commandArgs.find((arg) => arg.includes('@')) || commandArgs.at(-1) || 'plugin';
    const [pluginName = pluginRef, marketplace = 'default'] = pluginRef.split('@');
    return {
      id: `claude:plugin:${slugPart(`${pluginName}-${marketplace}`) || 'plugin'}`,
      type: 'skill',
      name: pluginRef,
      enabled: true,
      pathOrCommandOrUrl: pluginRef,
      command: 'claude',
      args: commandArgs,
      approvalMode: 'inherit',
      notes: 'Installed from Claude Code marketplace plugin command.',
      metadata: {
        source: 'claude_code_marketplace',
        kind: 'plugin',
        pluginName,
        marketplace,
        installCommand: ['claude', ...commandArgs].join(' '),
        activationCommand: '/reload-plugins',
      },
    };
  }
  const installUrl = firstUrlFromInput(input);
  const isMcp = mode === 'mcp';
  const mcpName = isMcp
    ? commandArgs.find((arg) => arg !== 'mcp' && arg !== 'add' && !/^https?:\/\//i.test(arg))
    : '';
  const skillName = displayNameFromLocation(installUrl || commandArgs.at(-1));
  const name = isMcp ? (mcpName || displayNameFromLocation(installUrl)) : skillName;
  return {
    id: `claude:${isMcp ? 'mcp' : 'skill'}:${slugPart(name) || (isMcp ? 'server' : 'skill')}`,
    type: isMcp ? 'mcp' : 'skill',
    name,
    enabled: true,
    transport: isMcp && installUrl ? 'http' : undefined,
    url: installUrl || undefined,
    pathOrCommandOrUrl: installUrl || commandArgs.join(' '),
    command: 'claude',
    args: commandArgs.length ? commandArgs : [isMcp ? 'mcp' : 'skill', 'add', installUrl].filter(Boolean),
    approvalMode: 'inherit',
    notes: isMcp ? 'Installed from Claude Code MCP command.' : 'Installed from Claude Code marketplace skill command.',
    metadata: {
      source: 'claude_code_marketplace',
      kind: isMcp ? 'mcp' : 'skill',
      qualifiedName: name,
      installCommand: ['claude', ...(commandArgs.length ? commandArgs : [])].join(' '),
    },
  };
}

export function buildPiExtensionCapabilityRecord(input) {
  const tokens = commandTokens(input);
  const commandIndex = tokens.findIndex((token) => /^pi(?:\.cmd|\.ps1)?$/i.test(token) || token.toLowerCase() === 'pi-agent');
  const commandArgs = commandIndex >= 0 ? tokens.slice(commandIndex + 1) : [];
  const location = firstUrlFromInput(input) || normalizeString(input);
  const name = displayNameFromLocation(location);
  return {
    id: `pi_extension:${slugPart(name) || 'extension'}`,
    type: 'pi_extension',
    name,
    enabled: true,
    url: /^https?:\/\//i.test(location) ? location : undefined,
    pathOrCommandOrUrl: location,
    command: commandArgs.length ? tokens[commandIndex] : undefined,
    args: commandArgs,
    approvalMode: 'inherit',
    notes: 'Installed from Pi Agent extension source.',
    metadata: {
      source: 'pi_agent_extension',
      kind: 'pi_extension',
      installTarget: 'pi_agent_extensions',
      installCommand: commandArgs.length ? [tokens[commandIndex], ...commandArgs].join(' ') : undefined,
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

export function buildCapabilityRecordFromInstallInput(input) {
  const text = normalizeString(input);
  if (!text) return null;
  if (isCodexPluginInput(text)) return buildCodexPluginCapabilityRecord(text);
  if (isCodexSkillInput(text)) return buildCodexSkillCapabilityRecord(text);
  if (isClaudeInput(text)) return buildClaudeCapabilityRecord(text);
  if (isPiExtensionInput(text)) return buildPiExtensionCapabilityRecord(text);
  if (isSmitherySkillInput(text) || /https?:\/\/(?:mcp\.)?smithery\.run\//i.test(text) || /https?:\/\/server\.smithery\.ai\//i.test(text)) {
    return buildCapabilityRecordFromSmitheryInstallInput(text);
  }
  return null;
}
