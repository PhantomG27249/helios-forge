function isContradictory(left, right) {
  return left.memoryId !== right.memoryId
    && left.subject
    && left.subject === right.subject
    && left.predicate
    && left.predicate === right.predicate
    && left.object !== right.object;
}

export function detectMemoryConflicts({ graph } = {}) {
  if (!graph) throw new Error('graph is required');

  const conflicts = [];
  const records = graph.listMemories().filter((record) => record.type !== 'memory_conflict');

  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const left = records[leftIndex];
      const right = records[rightIndex];
      if (!isContradictory(left, right)) continue;

      const conflictingMemoryIds = [left.memoryId, right.memoryId];
      graph.updateMemory(left.memoryId, {
        reviewStatus: 'quarantined',
        contradictions: [...(left.contradictions || []), right.memoryId],
      });
      graph.updateMemory(right.memoryId, {
        reviewStatus: 'quarantined',
        contradictions: [...(right.contradictions || []), left.memoryId],
      });

      const conflict = graph.addMemory({
        type: 'memory_conflict',
        summary: `Conflicting memories for ${left.subject} ${left.predicate}`,
        subject: left.subject,
        predicate: left.predicate,
        conflictingMemoryIds,
        evidence: [...(left.evidence || []), ...(right.evidence || [])],
        reviewStatus: 'needs_review',
        validatorBacked: false,
      });
      graph.addRelation({ from: conflict.memoryId, to: left.memoryId, type: 'conflicts_with' });
      graph.addRelation({ from: conflict.memoryId, to: right.memoryId, type: 'conflicts_with' });
      conflicts.push(conflict);
    }
  }

  return conflicts;
}
