import { parseToolCalls } from '../model/toolCallParser.js';
import { createToolCallRecovery } from '../reliability/toolCallRecovery.js';

function toolContracts(toolRegistry) {
  if (!toolRegistry?.list) return [];
  return toolRegistry.list().map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object' },
  }));
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

async function executeToolCall({ call, toolRegistry }) {
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
} = {}) {
  if (!modelGateway?.call) {
    throw new Error('Tool loop requires a modelGateway with call()');
  }

  let currentMessages = [...messages];
  const toolResults = [];
  let finalText = '';
  const recoveryManager = recovery?.enabled
    ? createToolCallRecovery({
      taskId,
      toolRegistry,
      emitEvent: recovery.emitEvent,
      noProgressThreshold: recovery.noProgressThreshold,
    })
    : null;

  function resultPayload(payload) {
    if (!recoveryManager) return payload;
    return {
      ...payload,
      recoveryEvents: [...recoveryManager.events],
    };
  }

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const response = await modelGateway.call({
      taskId,
      purpose,
      profileName,
      messages: currentMessages,
      tools: toolContracts(toolRegistry),
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
      let result = await executeToolCall({ call, toolRegistry });
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
