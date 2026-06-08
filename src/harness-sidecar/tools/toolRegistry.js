export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool?.name) {
      throw new Error('Tool registration requires a name');
    }
    const contract = {
      risk: 'low',
      description: '',
      inputSchema: {},
      ...tool,
    };
    this.tools.set(contract.name, contract);
    return contract;
  }

  get(name) {
    const tool = this.tools.get(name);
    return tool ? { ...tool, inputSchema: { ...tool.inputSchema } } : null;
  }

  async execute(name, args = {}) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    if (typeof tool.execute !== 'function') {
      throw new Error(`Tool is not executable: ${name}`);
    }
    return tool.execute(args);
  }

  list() {
    return [...this.tools.values()].map((tool) => ({
      ...tool,
      inputSchema: { ...tool.inputSchema },
    }));
  }
}
