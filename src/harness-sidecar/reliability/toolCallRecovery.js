import { parseToolCalls } from '../model/toolCallParser.js';
import { classifyHarnessFailure } from './errorTaxonomy.js';
import { NoProgressDetector } from './noProgressDetector.js';

function appendMissingClosers(text) {
  const source = String(text || '').trim();
  const stack = [];
  let inString = false;
  let escaped = false;

  for (const char of source) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') stack.push('}');
    if (char === '[') stack.push(']');
    if ((char === '}' || char === ']') && stack.at(-1) === char) stack.pop();
  }

  return `${source}${stack.reverse().join('')}`;
}

function listAvailableTools(toolRegistry) {
  if (!toolRegistry?.list) return [];
  return toolRegistry.list().map((tool) => tool.name).filter(Boolean);
}

export function recoverMalformedToolCalls({ text = '', toolCalls, tool_calls } = {}) {
  try {
    const calls = parseToolCalls({ text, toolCalls, tool_calls });
    if (calls.length > 0) {
      return {
        status: 'not_needed',
        calls,
        classification: null,
      };
    }
  } catch {
    // Fall through to repair below.
  }

  const repairedText = appendMissingClosers(text);
  const calls = repairedText === text ? [] : parseToolCalls({ text: repairedText });
  if (calls.length === 0) {
    return {
      status: 'unrecoverable',
      calls: [],
      classification: classifyHarnessFailure({ category: 'malformed_tool_call' }),
      repairedText,
    };
  }

  return {
    status: 'recovered',
    calls,
    classification: classifyHarnessFailure({ category: 'malformed_tool_call' }),
    repairedText,
  };
}

export function buildUnknownToolRecovery({ toolName, toolRegistry } = {}) {
  const classification = classifyHarnessFailure({ category: 'unknown_tool' });
  const availableTools = listAvailableTools(toolRegistry);

  return {
    ...classification,
    availableTools,
    instruction: availableTools.length > 0
      ? `Retry with one available tool: ${availableTools.join(', ')}.`
      : 'No tools are currently available; answer without a tool or request wiring.',
    toolName,
  };
}

export function createToolCallRecovery({
  taskId,
  toolRegistry,
  emitEvent,
  noProgressThreshold = 3,
} = {}) {
  const events = [];
  const detector = new NoProgressDetector({ threshold: noProgressThreshold });
  const sink = typeof emitEvent === 'function' ? emitEvent : () => {};

  function emit(event) {
    events.push(event);
    sink(event);
    return event;
  }

  function emitClassification(classification, detail = {}) {
    return emit({
      type: 'recovery.failure_classified',
      taskId,
      ...classification,
      detail,
    });
  }

  return {
    events,

    recoverCalls({ text, toolCalls, tool_calls } = {}) {
      const recovered = recoverMalformedToolCalls({ text, toolCalls, tool_calls });
      if (recovered.classification) {
        emitClassification(recovered.classification, {
          status: recovered.status,
          repaired: recovered.status === 'recovered',
        });
      }
      return recovered;
    },

    annotateToolResult(result = {}) {
      let annotated = result;
      if (result.reason === 'unknown_tool') {
        const recovery = buildUnknownToolRecovery({
          toolName: result.name,
          toolRegistry,
        });
        emitClassification(recovery, { toolName: result.name });
        annotated = { ...result, recovery };
      }

      const progress = detector.recordToolResult(annotated);
      if (progress.noProgress) {
        emit({
          type: 'recovery.no_progress_detected',
          taskId,
          category: 'no_progress',
          signature: progress.signature,
          count: progress.count,
          threshold: progress.threshold,
          repeatedFailure: progress.repeatedFailure,
          detail: progress.detail,
        });
      }

      return annotated;
    },
  };
}
