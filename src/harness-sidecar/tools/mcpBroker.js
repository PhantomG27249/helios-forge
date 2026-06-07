import { createApprovalRequest } from '../security/approvalGates.js';

export function brokerMcpToolCall({ taskId = 'task_mcp', tool, args = {}, policy }) {
  const decision = policy.evaluateToolCall({ tool, args });
  if (decision.requiresApproval) {
    return {
      status: 'approval_required',
      approval: createApprovalRequest({
        taskId,
        risk: decision.risk,
        reason: `MCP tool ${tool} requires approval`,
        proposedAction: { tool, args },
      }),
    };
  }
  if (!decision.allowed) {
    return {
      status: 'blocked',
      reason: `MCP tool ${tool} is not allowed by current policy`,
    };
  }
  return {
    status: 'allowed',
    tool,
    args,
  };
}
