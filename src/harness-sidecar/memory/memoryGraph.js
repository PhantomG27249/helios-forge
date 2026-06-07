function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function createMemoryId(index, type = 'memory') {
  return `mem_${type}_${String(index).padStart(4, '0')}`;
}

function createRelationId(index, type = 'rel') {
  return `rel_${type}_${String(index).padStart(4, '0')}`;
}

export class MemoryGraph {
  constructor() {
    this.memories = new Map();
    this.relations = [];
    this.nextMemoryIndex = 1;
    this.nextRelationIndex = 1;
  }

  addMemory(record = {}) {
    const memoryId = record.memoryId || createMemoryId(this.nextMemoryIndex, record.type);
    this.nextMemoryIndex += 1;

    const provenance = normalizeList(record.provenance);
    if (record.taskId || record.createdByTask) {
      provenance.push({
        taskId: record.taskId || record.createdByTask,
        evidence: normalizeList(record.evidence),
        sourceType: 'memory',
      });
    }

    const stored = {
      reviewStatus: 'candidate',
      evidence: [],
      ...record,
      memoryId,
      evidence: normalizeList(record.evidence),
      provenance,
      supersedes: normalizeList(record.supersedes),
      stale: Boolean(record.stale),
      contradictions: normalizeList(record.contradictions),
    };

    this.memories.set(memoryId, stored);

    for (const supersededId of stored.supersedes) {
      const superseded = this.memories.get(supersededId);
      if (superseded) {
        superseded.stale = true;
        superseded.supersededBy = memoryId;
        this.addRelation({
          from: memoryId,
          to: supersededId,
          type: 'supersedes',
          provenance,
        });
      }
    }

    return stored;
  }

  updateMemory(memoryId, patch = {}) {
    const existing = this.memories.get(memoryId);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...patch,
      evidence: patch.evidence ? normalizeList(patch.evidence) : existing.evidence,
      provenance: patch.provenance
        ? [...existing.provenance, ...normalizeList(patch.provenance)]
        : existing.provenance,
      supersedes: patch.supersedes ? normalizeList(patch.supersedes) : existing.supersedes,
      contradictions: patch.contradictions
        ? normalizeList(patch.contradictions)
        : existing.contradictions,
    };
    this.memories.set(memoryId, updated);
    return updated;
  }

  getMemory(memoryId) {
    return this.memories.get(memoryId) || null;
  }

  listMemories() {
    return [...this.memories.values()];
  }

  findByType(type) {
    return this.listMemories().filter((memory) => memory.type === type);
  }

  addRelation(relation = {}) {
    const existing = this.relations.find((candidate) => (
      candidate.from === relation.from
      && candidate.to === relation.to
      && candidate.type === relation.type
    ));
    if (existing) {
      existing.provenance = [
        ...normalizeList(existing.provenance),
        ...normalizeList(relation.provenance),
      ];
      return existing;
    }

    const stored = {
      relationId: relation.relationId || createRelationId(this.nextRelationIndex, relation.type),
      provenance: [],
      ...relation,
      provenance: normalizeList(relation.provenance),
    };
    this.nextRelationIndex += 1;
    this.relations.push(stored);
    return stored;
  }

  findRelations({ from, to, type } = {}) {
    return this.relations.filter((relation) => (
      (!from || relation.from === from)
      && (!to || relation.to === to)
      && (!type || relation.type === type)
    ));
  }
}
