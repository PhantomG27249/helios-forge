import { repairJsonObject } from './structuredOutputRepair.js';

export function parseToolCall(text) {
  try {
    const parsed = repairJsonObject(text);
    if (!parsed.tool || typeof parsed.tool !== 'string') {
      return { valid: false, error: 'Tool call is missing tool name' };
    }
    if (!parsed.args || typeof parsed.args !== 'object') {
      return { valid: false, error: 'Tool call is missing args object' };
    }
    return {
      valid: true,
      tool: parsed.tool,
      args: parsed.args,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
    };
  }
}
