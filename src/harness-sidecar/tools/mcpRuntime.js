import { McpClient } from './mcpClient.js';

function now() {
  return Date.now();
}

function normalizeStatus(decision) {
  if (!decision) return { status: 'allowed' };
  if (decision.status) return decision;
  if (decision.requiresApproval) {
    return {
      status: 'approval_required',
      approval: decision.approval,
      reason: decision.reason,
      risk: decision.risk,
    };
  }
  if (decision.allowed === false) {
    return {
      status: 'blocked',
      reason: decision.reason || 'MCP tool call blocked by policy',
      risk: decision.risk,
    };
  }
  return { status: 'allowed' };
}

function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timeout;
  const timer = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timer]).finally(() => clearTimeout(timeout));
}

export class McpRuntimeRegistry {
  constructor({
    servers = [],
    transportFactory,
    policy,
    broker,
    callTimeoutMs = 30_000,
    clock = now,
  } = {}) {
    if (typeof transportFactory !== 'function') {
      throw new Error('McpRuntimeRegistry requires a transportFactory');
    }
    this.transportFactory = transportFactory;
    this.policy = policy;
    this.broker = broker;
    this.callTimeoutMs = callTimeoutMs;
    this.clock = clock;
    this.servers = new Map(servers.map((server) => [server.id, { ...server }]));
    this.instances = new Map();
    this.auditEntries = [];
  }

  audit(entry) {
    const auditEntry = {
      timestamp: this.clock(),
      ...entry,
    };
    this.auditEntries.push(auditEntry);
    return auditEntry;
  }

  ensureServer(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Unknown MCP server ${serverId}`);
    }
    return server;
  }

  status(serverId) {
    if (!this.servers.has(serverId)) {
      return { serverId, status: 'unknown' };
    }
    const instance = this.instances.get(serverId);
    return {
      serverId,
      status: instance?.running ? 'running' : 'stopped',
      serverInfo: instance?.serverInfo,
    };
  }

  async start(serverId) {
    const server = this.ensureServer(serverId);
    const existing = this.instances.get(serverId);
    if (existing?.running) return this.status(serverId);

    const transport = await this.transportFactory({ server, serverId });
    const client = new McpClient({ transport });
    const init = await client.initialize();
    this.instances.set(serverId, {
      server,
      transport,
      client,
      serverInfo: init.serverInfo,
      running: true,
    });
    this.audit({ type: 'mcp.server.started', serverId });
    return this.status(serverId);
  }

  async stop(serverId) {
    this.ensureServer(serverId);
    const instance = this.instances.get(serverId);
    if (!instance?.running) return this.status(serverId);

    if (typeof instance.transport.close === 'function') {
      await instance.transport.close();
    } else if (typeof instance.transport.stop === 'function') {
      await instance.transport.stop();
    }
    instance.running = false;
    this.audit({ type: 'mcp.server.stopped', serverId });
    return this.status(serverId);
  }

  getRunning(serverId) {
    const instance = this.instances.get(serverId);
    if (!instance?.running) {
      throw new Error(`MCP server ${serverId} is not running`);
    }
    return instance;
  }

  async listTools(serverId) {
    const instance = this.getRunning(serverId);
    const tools = await withTimeout(
      instance.client.listTools(),
      this.callTimeoutMs,
      `MCP tools/list ${serverId}`,
    );
    return tools.map((tool) => ({ serverId, ...tool }));
  }

  evaluatePolicy({ serverId, tool, args }) {
    const server = this.ensureServer(serverId);
    if (typeof this.broker === 'function') {
      return normalizeStatus(this.broker({ serverId, server, tool, args, policy: this.policy }));
    }
    if (typeof this.policy === 'function') {
      return normalizeStatus(this.policy({ serverId, server, tool, args }));
    }
    if (this.policy && typeof this.policy.evaluateToolCall === 'function') {
      return normalizeStatus(this.policy.evaluateToolCall({ tool, args, serverId, server }));
    }
    return { status: 'allowed' };
  }

  async callTool(serverId, tool, args = {}, options = {}) {
    const instance = this.getRunning(serverId);
    const decision = this.evaluatePolicy({ serverId, tool, args });
    if (decision.status === 'blocked') {
      this.audit({ type: 'mcp.tool.blocked', serverId, tool, reason: decision.reason });
      return decision;
    }
    if (decision.status === 'approval_required') {
      this.audit({ type: 'mcp.tool.approval_required', serverId, tool, reason: decision.reason });
      return decision;
    }

    try {
      const result = await withTimeout(
        instance.client.callTool(tool, args),
        options.timeoutMs ?? this.callTimeoutMs,
        `MCP tools/call ${serverId}.${tool}`,
      );
      this.audit({ type: 'mcp.tool.called', serverId, tool, isError: result.isError === true });
      return {
        status: 'completed',
        ...result,
      };
    } catch (error) {
      this.audit({ type: 'mcp.tool.failed', serverId, tool, reason: error.message });
      throw error;
    }
  }
}
