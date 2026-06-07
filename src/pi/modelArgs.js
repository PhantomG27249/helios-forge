import { readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

function tokenizeArgs(args) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of String(args || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function getArgValue(tokens, name) {
  const index = tokens.indexOf(name);
  if (index === -1 || index + 1 >= tokens.length) return null;
  return tokens[index + 1];
}

function parseNumber(tokens, flag, parser) {
  const value = getArgValue(tokens, flag);
  if (value === null) return undefined;
  const parsed = parser(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseZeusArgs(args) {
  const tokens = tokenizeArgs(args);
  const params = {};

  const temperature = parseNumber(tokens, '--temp', Number.parseFloat);
  if (temperature !== undefined) params.temperature = temperature;

  const topP = parseNumber(tokens, '--top-p', Number.parseFloat);
  if (topP !== undefined) params.top_p = topP;

  const topK = parseNumber(tokens, '--top-k', (value) => Number.parseInt(value, 10));
  if (topK !== undefined) params.top_k = topK;

  const minP = parseNumber(tokens, '--min-p', Number.parseFloat);
  if (minP !== undefined) params.min_p = minP;

  const repeatPenalty = parseNumber(tokens, '--repeat-penalty', Number.parseFloat);
  if (repeatPenalty !== undefined) params.repetition_penalty = repeatPenalty;

  const presencePenalty = parseNumber(tokens, '--presence-penalty', Number.parseFloat);
  if (presencePenalty !== undefined) params.presence_penalty = presencePenalty;

  const seed = parseNumber(tokens, '--seed', (value) => Number.parseInt(value, 10));
  if (seed !== undefined) params.seed = seed;

  const chatTemplateRaw = getArgValue(tokens, '--chat-template-kwargs');
  if (chatTemplateRaw) {
    try {
      const kwargs = JSON.parse(chatTemplateRaw.replace(/\\"/g, '"'));
      params.chat_template_kwargs = { ...kwargs };
      if (kwargs.enable_thinking !== undefined) {
        params.chat_template_kwargs.preserve_thinking = kwargs.enable_thinking;
      }
    } catch {
      // Ignore malformed per-model JSON and keep other parsed args.
    }
  }

  return Object.keys(params).length > 0 ? params : null;
}

export function buildModelArgsLookup(rawJson) {
  const config = JSON.parse(String(rawJson || '').replace(/^\uFEFF/, ''));
  const lookup = {};

  for (const [providerName, provider] of Object.entries(config.providers || {})) {
    for (const model of provider?.models || []) {
      if (!model?.args) continue;
      const entry = { providerName, modelId: model.id, args: model.args };
      lookup[`${providerName}/${model.id}`] = entry;
      lookup[model.id] = entry;
    }
  }

  return lookup;
}

export function createModelArgsResolver({
  readFile = (filePath) => readFileSync(filePath, 'utf8'),
  statFile = (filePath) => statSync(filePath),
  modelsPath = resolve(join(process.env.HOME || process.env.USERPROFILE || '', '.pi', 'agent', 'models.json')),
} = {}) {
  let cachedLookup = null;
  let cachedMtimeMs = null;

  return function getModelArgsLookup() {
    try {
      const mtimeMs = statFile(modelsPath).mtimeMs;
      if (cachedLookup && cachedMtimeMs === mtimeMs) return cachedLookup;
      cachedLookup = buildModelArgsLookup(readFile(modelsPath));
      cachedMtimeMs = mtimeMs;
      return cachedLookup;
    } catch {
      return null;
    }
  };
}

export function createProviderRequestPatch({
  payload,
  modelId,
  providerName,
  providerKey,
  lookup,
}) {
  if (!payload?.model || !lookup) return null;

  const entry =
    lookup[`${providerName}/${modelId}`] ||
    lookup[modelId] ||
    lookup[`${providerKey}/${modelId}`] ||
    lookup[payload.model];

  if (!entry) return null;

  const parsed = parseZeusArgs(entry.args);
  if (!parsed) return null;
  return {
    ...payload,
    ...parsed,
  };
}
