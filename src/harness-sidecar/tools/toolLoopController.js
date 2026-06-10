import { parseToolCalls } from '../model/toolCallParser.js';
import { createToolCallRecovery } from '../reliability/toolCallRecovery.js';

function normalizeAllowedToolSet({ allowedTools, toolCaps } = {}) {
  const source = Array.isArray(allowedTools)
    ? allowedTools
    : Array.isArray(toolCaps)
      ? toolCaps
      : Array.isArray(toolCaps?.allowed)
        ? toolCaps.allowed
        : Array.isArray(toolCaps?.allowedTools)
          ? toolCaps.allowedTools
          : undefined;
  if (source === undefined) return null;
  return new Set(source.filter(Boolean).map(String));
}

function isToolAllowed(name, allowedToolSet) {
  return !allowedToolSet || allowedToolSet.has(name);
}

function listAllowedTools(toolRegistry, allowedToolSet) {
  if (!toolRegistry?.list) return [];
  return toolRegistry.list().filter((tool) => isToolAllowed(tool.name, allowedToolSet));
}

function toolContracts(toolRegistry, allowedToolSet) {
  return listAllowedTools(toolRegistry, allowedToolSet).map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object' },
  }));
}

function recoveryToolRegistry(toolRegistry, allowedToolSet) {
  if (!allowedToolSet) return toolRegistry;
  return {
    list: () => listAllowedTools(toolRegistry, allowedToolSet),
  };
}

function resultStatusForTool(tool) {
  if (!tool) return { status: 'blocked', reason: 'unknown_tool' };
  if (tool.blocked) return { status: 'blocked', reason: 'tool_blocked' };
  if (tool.requiresApproval) return { status: 'approval_required', reason: 'approval_required' };
  return { status: 'ready' };
}

function toolMessage({ call, result }) {
  return {
    role: 'tool',
    tool_call_id: call.id ?? result.id ?? call.name,
    name: call.name,
    content: JSON.stringify({
      status: result.status,
      result: result.result,
      reason: result.reason,
      error: result.error,
    }),
  };
}

function terminalStatus(toolResults) {
  if (toolResults.some((result) => result.status === 'blocked')) return 'blocked';
  if (toolResults.some((result) => result.status === 'approval_required')) return 'approval_required';
  return null;
}

function policyMetadata(policy) {
  if (!policy) return undefined;
  return {
    policyId: policy.policyId,
    status: policy.status || 'shadow_only',
    mode: 'metadata_only',
  };
}

async function executeToolCall({ call, toolRegistry, allowedToolSet }) {
  if (!isToolAllowed(call.name, allowedToolSet)) {
    return {
      id: call.id,
      name: call.name,
      status: 'blocked',
      reason: 'tool_not_allowed',
    };
  }

  const tool = toolRegistry?.get?.(call.name);
  const gate = resultStatusForTool(tool);
  if (gate.status !== 'ready') {
    return {
      id: call.id,
      name: call.name,
      status: gate.status,
      reason: gate.reason,
    };
  }

  try {
    const result = await toolRegistry.execute(call.name, call.args);
    if (['blocked', 'approval_required'].includes(result?.status)) {
      return {
        id: call.id,
        name: call.name,
        status: result.status,
        reason: result.reason,
        result,
      };
    }
    return {
      id: call.id,
      name: call.name,
      status: 'completed',
      result,
    };
  } catch (error) {
    return {
      id: call.id,
      name: call.name,
      status: 'blocked',
      reason: 'tool_error',
      error: error.message,
    };
  }
}

export async function runToolLoop({
  taskId,
  purpose = 'tool_loop',
  profileName,
  messages = [],
  modelGateway,
  toolRegistry,
  maxIterations = 5,
  recovery,
  policy = null,
  allowedTools,
  toolCaps,
} = {}) {
  if (!modelGateway?.call) {
    throw new Error('Tool loop requires a modelGateway with call()');
  }

  const allowedToolSet = normalizeAllowedToolSet({ allowedTools, toolCaps });
  let currentMessages = [...messages];
  const toolResults = [];
  let finalText = '';
  const recoveryManager = recovery?.enabled
    ? createToolCallRecovery({
      taskId,
      toolRegistry: recoveryToolRegistry(toolRegistry, allowedToolSet),
      emitEvent: recovery.emitEvent,
      noProgressThreshold: recovery.noProgressThreshold,
    })
    : null;

  function resultPayload(payload) {
    const withPolicy = policy
      ? { ...payload, policy: policyMetadata(policy) }
      : payload;
    if (!recoveryManager) return withPolicy;
    return {
      ...withPolicy,
      recoveryEvents: [...recoveryManager.events],
    };
  }

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const response = await modelGateway.call({
      taskId,
      purpose,
      profileName,
      messages: currentMessages,
      tools: toolContracts(toolRegistry, allowedToolSet),
    });
    let calls;
    if (recoveryManager) {
      const recovered = recoveryManager.recoverCalls({
        text: response.text,
        toolCalls: response.toolCalls,
        tool_calls: response.tool_calls,
      });
      calls = recovered.calls;
    } else {
      calls = parseToolCalls({
        text: response.text,
        toolCalls: response.toolCalls ?? response.tool_calls,
      });
    }

    if (calls.length === 0) {
      finalText = response.text || '';
      return resultPayload({
        status: 'completed',
        finalText,
        iterations: iteration,
        toolResults,
      });
    }

    const iterationResults = [];
    for (const call of calls) {
      let result = await executeToolCall({ call, toolRegistry, allowedToolSet });
      if (recoveryManager) {
        result = recoveryManager.annotateToolResult(result);
      }
      iterationResults.push(result);
      toolResults.push(result);
    }

    const blockedStatus = terminalStatus(iterationResults);
    if (blockedStatus) {
      return resultPayload({
        status: blockedStatus,
        finalText,
        iterations: iteration,
        toolResults,
      });
    }

    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        content: response.text || '',
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: JSON.stringify(call.args || {}),
          },
        })),
      },
      ...calls.map((call, index) => toolMessage({ call, result: iterationResults[index] })),
    ];
  }

  return resultPayload({
    status: 'max_iterations',
    finalText,
    iterations: maxIterations,
    toolResults,
  });
}
