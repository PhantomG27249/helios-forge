import { repairJsonObject } from './structuredOutputRepair.js';

function parseArgs(args) {
  if (args === undefined || args === null || args === '') return {};
  if (typeof args === 'string') return repairJsonObject(args);
  if (typeof args === 'object' && !Array.isArray(args)) return args;
  throw new Error('Tool call args must be an object');
}

function normalizeToolCall(call) {
  const name = call?.name || call?.tool || call?.function?.name;
  if (!name || typeof name !== 'string') {
    throw new Error('Tool call is missing tool name');
  }
  const args = parseArgs(call.args ?? call.arguments ?? call.function?.arguments);
  return {
    id: call.id ?? null,
    name,
    args,
  };
}

export function parseToolCalls({ text = '', toolCalls, tool_calls } = {}) {
  const nativeCalls = toolCalls ?? tool_calls;
  if (Array.isArray(nativeCalls) && nativeCalls.length > 0) {
    return nativeCalls.map(normalizeToolCall);
  }

  if (!text || typeof text !== 'string') return [];
  try {
    const parsed = repairJsonObject(text);
    if (Array.isArray(parsed.toolCalls) || Array.isArray(parsed.tool_calls)) {
      return parseToolCalls({ toolCalls: parsed.toolCalls, tool_calls: parsed.tool_calls });
    }
    if (parsed.tool || parsed.name || parsed.function?.name) {
      return [normalizeToolCall(parsed)];
    }
    return [];
  } catch {
    return [];
  }
}

export function parseToolCall(text) {
  try {
    const parsed = parseToolCalls({ text })[0];
    if (!parsed?.name) {
      return { valid: false, error: 'Tool call is missing tool name' };
    }
    if (!parsed.args || typeof parsed.args !== 'object') {
      return { valid: false, error: 'Tool call is missing args object' };
    }
    return {
      valid: true,
      tool: parsed.name,
      args: parsed.args,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
    };
  }
}
