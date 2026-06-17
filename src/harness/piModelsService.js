import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseEnableThinkingFromArgs } from '../pi/modelArgs.js';

export function modelsJsonPath() {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return path.join(home, '.pi', 'agent', 'models.json');
}

export function setEnableThinkingInArgs(args, enabled) {
  const value = enabled ? 'true' : 'false';
  const source = String(args || '');
  if (/enable_thinking\\":(true|false)/i.test(source)) {
    return source.replace(/enable_thinking\\":(true|false)/gi, `enable_thinking\\":${value}`);
  }
  if (/enable_thinking":(true|false)/i.test(source)) {
    return source.replace(/enable_thinking":(true|false)/gi, `enable_thinking":${value}`);
  }
  const suffix = `--reasoning-parser qwen3 --chat-template-kwargs '{"enable_thinking":${value}}'`;
  return source.trim() ? `${source.trim()} ${suffix}` : suffix;
}

export async function setModelEnableThinking({
  provider,
  modelId,
  enabled,
  modelsPath = modelsJsonPath(),
} = {}) {
  if (!provider || !modelId) {
    throw new Error('provider and modelId are required');
  }
  if (typeof enabled !== 'boolean') {
    throw new Error('enabled must be a boolean');
  }

  const raw = await readFile(modelsPath, 'utf8');
  const config = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const providerEntry = config.providers?.[provider];
  if (!providerEntry) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const model = (providerEntry.models || []).find((entry) => entry?.id === modelId);
  if (!model) {
    throw new Error(`Unknown model: ${provider}/${modelId}`);
  }

  model.args = setEnableThinkingInArgs(model.args, enabled);
  await writeFile(modelsPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return {
    provider,
    modelId,
    enableThinking: parseEnableThinkingFromArgs(model.args),
    args: model.args,
  };
}
