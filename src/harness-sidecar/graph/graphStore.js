export class GraphStore {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
  }

  upsertNode(node) {
    const existing = this.nodes.get(node.id) || {};
    const provenance = [
      ...(existing.provenance || []),
      ...(node.provenance || []),
    ];
    const merged = { ...existing, ...node, provenance };
    this.nodes.set(node.id, merged);
    return merged;
  }

  getNode(id) {
    return this.nodes.get(id) || null;
  }

  upsertEdge(edge) {
    const existing = this.edges.find((candidate) => (
      candidate.from === edge.from
      && candidate.to === edge.to
      && candidate.type === edge.type
    ));

    if (existing) {
      existing.provenance = [
        ...(existing.provenance || []),
        ...(edge.provenance || []),
      ];
      return existing;
    }

    const stored = {
      provenance: [],
      ...edge,
    };
    this.edges.push(stored);
    return stored;
  }

  findEdges({ from, to, type } = {}) {
    return this.edges.filter((edge) => (
      (!from || edge.from === from)
      && (!to || edge.to === to)
      && (!type || edge.type === type)
    ));
  }
}
