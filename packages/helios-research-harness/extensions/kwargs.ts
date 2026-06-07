import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

type LookupEntry = { providerName: string; modelId: string; args: string };

function tokenizeArgs(args: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;

  for (const char of String(args || "")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function getArgValue(tokens: string[], name: string): string | null {
  const index = tokens.indexOf(name);
  if (index === -1 || index + 1 >= tokens.length) return null;
  return tokens[index + 1];
}

function parseNumber(tokens: string[], flag: string, parser: (value: string) => number): number | undefined {
  const value = getArgValue(tokens, flag);
  if (value === null) return undefined;
  const parsed = parser(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseZeusArgs(args: string): Record<string, any> | null {
  const tokens = tokenizeArgs(args);
  const params: Record<string, any> = {};

  const temperature = parseNumber(tokens, "--temp", Number.parseFloat);
  if (temperature !== undefined) params.temperature = temperature;

  const topP = parseNumber(tokens, "--top-p", Number.parseFloat);
  if (topP !== undefined) params.top_p = topP;

  const topK = parseNumber(tokens, "--top-k", (value) => Number.parseInt(value, 10));
  if (topK !== undefined) params.top_k = topK;

  const minP = parseNumber(tokens, "--min-p", Number.parseFloat);
  if (minP !== undefined) params.min_p = minP;

  const repeatPenalty = parseNumber(tokens, "--repeat-penalty", Number.parseFloat);
  if (repeatPenalty !== undefined) params.repetition_penalty = repeatPenalty;

  const presencePenalty = parseNumber(tokens, "--presence-penalty", Number.parseFloat);
  if (presencePenalty !== undefined) params.presence_penalty = presencePenalty;

  const seed = parseNumber(tokens, "--seed", (value) => Number.parseInt(value, 10));
  if (seed !== undefined) params.seed = seed;

  const chatTemplateRaw = getArgValue(tokens, "--chat-template-kwargs");
  if (chatTemplateRaw) {
    try {
      const kwargs = JSON.parse(chatTemplateRaw.replace(/\\"/g, "\""));
      params.chat_template_kwargs = { ...kwargs };
      if (kwargs.enable_thinking !== undefined) {
        params.chat_template_kwargs.preserve_thinking = kwargs.enable_thinking;
      }
    } catch {
      // Keep other parsed args when the per-model JSON is malformed.
    }
  }

  return Object.keys(params).length > 0 ? params : null;
}

function buildModelArgsLookup(rawJson: string): Record<string, LookupEntry> {
  const config = JSON.parse(String(rawJson || "").replace(/^\uFEFF/, ""));
  const lookup: Record<string, LookupEntry> = {};

  for (const [providerName, provider] of Object.entries<any>(config.providers || {})) {
    for (const model of provider?.models || []) {
      if (!model?.args) continue;
      const entry = { providerName, modelId: model.id, args: model.args };
      lookup[`${providerName}/${model.id}`] = entry;
      lookup[model.id] = entry;
    }
  }

  return lookup;
}

export default function (pi: ExtensionAPI) {
  let cachedLookup: Record<string, LookupEntry> | null = null;
  let cachedMtimeMs: number | null = null;

  function getModelArgsLookup(): Record<string, LookupEntry> | null {
    const homedir = process.env.HOME || process.env.USERPROFILE || "";
    const modelsPath = resolve(join(homedir, ".pi", "agent", "models.json"));

    try {
      const mtimeMs = statSync(modelsPath).mtimeMs;
      if (cachedLookup && cachedMtimeMs === mtimeMs) return cachedLookup;
      cachedLookup = buildModelArgsLookup(readFileSync(modelsPath, "utf-8"));
      cachedMtimeMs = mtimeMs;
      return cachedLookup;
    } catch {
      return null;
    }
  }

  pi.on("before_provider_request", (event, ctx) => {
    if (!event.payload?.model) return;

    const modelId = ctx.model?.id || event.payload.model;
    const providerName = ctx.model?.provider?.name || "";
    const providerKey = ctx.model?.provider?.apiKey || "";
    const lookup = getModelArgsLookup();
    if (!lookup) return;

    const entry =
      lookup[`${providerName}/${modelId}`] ||
      lookup[modelId] ||
      lookup[`${providerKey}/${modelId}`] ||
      lookup[event.payload.model];

    if (!entry) return;

    const parsed = parseZeusArgs(entry.args);
    if (!parsed) return;
    return { ...event.payload, ...parsed };
  });
}
