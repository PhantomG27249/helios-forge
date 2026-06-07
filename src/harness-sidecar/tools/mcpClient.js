function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createMcpError(message, details) {
  const error = new Error(message);
  if (details !== undefined) error.details = details;
  return error;
}

function validateJsonRpcResponse(response, expectedId) {
  if (!isObject(response)) {
    throw createMcpError('Invalid MCP JSON-RPC response: expected object', response);
  }
  if (response.jsonrpc !== '2.0') {
    throw createMcpError('Invalid MCP JSON-RPC response: missing jsonrpc 2.0', response);
  }
  if (response.id !== expectedId) {
    throw createMcpError('Invalid MCP JSON-RPC response: id mismatch', response);
  }
  if (response.error) {
    const message = isObject(response.error) && typeof response.error.message === 'string'
      ? response.error.message
      : 'MCP JSON-RPC error';
    throw createMcpError(message, response.error);
  }
  if (!('result' in response)) {
    throw createMcpError('Invalid MCP JSON-RPC response: missing result', response);
  }
  return response.result;
}

function validateInitializeResult(result) {
  if (!isObject(result)) {
    throw createMcpError('Invalid MCP initialize response: expected object', result);
  }
  if (result.serverInfo !== undefined && !isObject(result.serverInfo)) {
    throw createMcpError('Invalid MCP initialize response: serverInfo must be object', result);
  }
  if (result.capabilities !== undefined && !isObject(result.capabilities)) {
    throw createMcpError('Invalid MCP initialize response: capabilities must be object', result);
  }
  return result;
}

function validateTool(tool) {
  if (!isObject(tool)) return false;
  if (typeof tool.name !== 'string' || tool.name.length === 0) return false;
  if (tool.description !== undefined && typeof tool.description !== 'string') return false;
  if (!isObject(tool.inputSchema)) return false;
  return true;
}

function validateListToolsResult(result) {
  if (!isObject(result) || !Array.isArray(result.tools) || !result.tools.every(validateTool)) {
    throw createMcpError('Invalid MCP tools/list response', result);
  }
  return result.tools;
}

function validateContentItem(item) {
  if (!isObject(item)) return false;
  if (typeof item.type !== 'string' || item.type.length === 0) return false;
  return true;
}

function validateCallToolResult(result) {
  if (!isObject(result) || !Array.isArray(result.content) || !result.content.every(validateContentItem)) {
    throw createMcpError('Invalid MCP tools/call response', result);
  }
  if (result.isError !== undefined && typeof result.isError !== 'boolean') {
    throw createMcpError('Invalid MCP tools/call response: isError must be boolean', result);
  }
  return result;
}

export class McpClient {
  constructor({ transport, clientInfo = { name: 'helios-forge', version: '1.0.0' } } = {}) {
    if (!transport || (typeof transport.send !== 'function' && typeof transport.request !== 'function')) {
      throw new Error('McpClient requires a transport with send(request) or request(method, params)');
    }
    this.transport = transport;
    this.clientInfo = clientInfo;
    this.nextId = 1;
    this.initialized = false;
  }

  async request(method, params = {}) {
    if (typeof method !== 'string' || method.length === 0) {
      throw new Error('MCP method must be a non-empty string');
    }
    if (typeof this.transport.request === 'function') {
      const result = await this.transport.request(method, params);
      if (isObject(result) && result.jsonrpc === '2.0') {
        return validateJsonRpcResponse(result, result.id);
      }
      return result;
    }

    const id = this.nextId;
    this.nextId += 1;
    const response = await this.transport.send({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
    return validateJsonRpcResponse(response, id);
  }

  async initialize(params = {}) {
    const result = validateInitializeResult(await this.request('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: this.clientInfo,
      capabilities: {},
      ...params,
    }));
    this.initialized = true;
    return result;
  }

  async listTools(params = {}) {
    return validateListToolsResult(await this.request('tools/list', params));
  }

  async callTool(name, args = {}) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('MCP tool name must be a non-empty string');
    }
    if (!isObject(args)) {
      throw new Error('MCP tool arguments must be an object');
    }
    return validateCallToolResult(await this.request('tools/call', {
      name,
      arguments: args,
    }));
  }
}

export const validation = {
  validateCallToolResult,
  validateListToolsResult,
};
