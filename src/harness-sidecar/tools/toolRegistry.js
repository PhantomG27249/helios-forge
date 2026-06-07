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

  list() {
    return [...this.tools.values()].map((tool) => ({
      ...tool,
      inputSchema: { ...tool.inputSchema },
    }));
  }
}
