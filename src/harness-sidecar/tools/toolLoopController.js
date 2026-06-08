import { parseToolCalls } from '../model/toolCallParser.js';

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
    return {
      id: call.id,
      name: call.name,
      status: 'completed',
      result: await toolRegistry.execute(call.name, call.args),
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
} = {}) {
  if (!modelGateway?.call) {
    throw new Error('Tool loop requires a modelGateway with call()');
  }

  let currentMessages = [...messages];
  const toolResults = [];
  let finalText = '';

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const response = await modelGateway.call({
      taskId,
      purpose,
      profileName,
      messages: currentMessages,
      tools: toolContracts(toolRegistry),
    });
    const calls = parseToolCalls({
      text: response.text,
      toolCalls: response.toolCalls ?? response.tool_calls,
    });

    if (calls.length === 0) {
      finalText = response.text || '';
      return {
        status: 'completed',
        finalText,
        iterations: iteration,
        toolResults,
      };
    }

    const iterationResults = [];
    for (const call of calls) {
      const result = await executeToolCall({ call, toolRegistry });
      iterationResults.push(result);
      toolResults.push(result);
    }

    const blockedStatus = terminalStatus(iterationResults);
    if (blockedStatus) {
      return {
        status: blockedStatus,
        finalText,
        iterations: iteration,
        toolResults,
      };
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

  return {
    status: 'max_iterations',
    finalText,
    iterations: maxIterations,
    toolResults,
  };
}
