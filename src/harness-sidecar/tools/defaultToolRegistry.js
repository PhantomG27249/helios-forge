import { ToolRegistry } from './toolRegistry.js';
import { runShellCommand } from './shellBroker.js';
import { runVerifiers } from './verifierRunner.js';

function mcpRuntimeRequired() {
  throw new Error('mcpRuntime is required for mcp.call');
}

export function createDefaultToolRegistry({
  workspaceRoot,
  emitEvent = () => {},
  mcpRuntime,
  maxOutputBytes = 64 * 1024,
} = {}) {
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }

  const registry = new ToolRegistry();
  registry.register({
    name: 'shell.run',
    description: 'Run a scoped shell command inside the workspace.',
    risk: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['command'],
    },
    execute: async ({ command, cwd, timeoutMs } = {}) => runShellCommand({
      command,
      cwd: cwd || workspaceRoot,
      workspaceRoot,
      timeoutMs,
      maxOutputBytes,
    }),
  });

  registry.register({
    name: 'verifier.run',
    description: 'Run one or more scoped verifier commands inside the workspace.',
    risk: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        verifiers: { type: 'array' },
      },
      required: ['verifiers'],
    },
    execute: async ({ taskId, verifiers = [] } = {}) => ({
      results: await runVerifiers({
        workspaceRoot,
        taskId,
        verifiers,
        emitEvent,
        maxOutputBytes,
      }),
    }),
  });

  registry.register({
    name: 'mcp.call',
    description: 'Call a tool on a running MCP server through policy-gated runtime.',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        tool: { type: 'string' },
        args: { type: 'object' },
      },
      required: ['serverId', 'tool'],
    },
    execute: async ({ serverId, tool, args = {}, options = {} } = {}) => {
      const runtime = mcpRuntime || { callTool: mcpRuntimeRequired };
      return runtime.callTool(serverId, tool, args, options);
    },
  });

  return registry;
}
