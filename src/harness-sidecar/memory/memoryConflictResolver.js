import { normalizeResolutionEvidence } from './provenanceResolutionAgents.js';

function isContradictory(left, right) {
  return left.memoryId !== right.memoryId
    && left.subject
    && left.subject === right.subject
    && left.predicate
    && left.predicate === right.predicate
    && left.object !== right.object;
}

function provenanceRef(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return value.id
      || value.passageId
      || value.provenanceId
      || value.provenanceRef
      || value.ref
      || value.sourceId
      || value.traceId
      || null;
  }
  return String(value);
}

function isStaleEvidence(value = {}) {
  return Boolean(value)
    && typeof value === 'object'
    && (
      value.stale === true
      || value.superseded === true
      || Boolean(value.supersededBy)
      || value.status === 'stale'
      || value.sourceStatus === 'stale'
    );
}

function partitionProvenanceRefs(record = {}) {
  const evidence = [...(record.evidence || [])];
  if (isStaleEvidence(record)) {
    return {
      knownProvenanceRefs: [],
      blockedProvenanceRefs: evidence.map(provenanceRef).filter(Boolean),
    };
  }
  return {
    knownProvenanceRefs: evidence.filter((item) => !isStaleEvidence(item)).map(provenanceRef).filter(Boolean),
    blockedProvenanceRefs: evidence.filter(isStaleEvidence).map(provenanceRef).filter(Boolean),
  };
}

function mergeProvenancePartitions(...partitions) {
  return {
    knownProvenanceRefs: partitions.flatMap((partition) => partition.knownProvenanceRefs),
    blockedProvenanceRefs: partitions.flatMap((partition) => partition.blockedProvenanceRefs),
  };
}

function guardedResolutionFor(evidence, { knownProvenanceRefs = [], blockedProvenanceRefs = [] } = {}) {
  if (!evidence) return undefined;
  return normalizeResolutionEvidence(evidence, { knownProvenanceRefs, blockedProvenanceRefs });
}

export function detectMemoryConflicts({ graph, guardedResolutionEvidence } = {}) {
  if (!graph) throw new Error('graph is required');

  const conflicts = [];
  const records = graph.listMemories().filter((record) => record.type !== 'memory_conflict');

  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const left = records[leftIndex];
      const right = records[rightIndex];
      if (!isContradictory(left, right)) continue;

      const conflictingMemoryIds = [left.memoryId, right.memoryId];
      const evidence = [...(left.evidence || []), ...(right.evidence || [])];
      const provenanceRefs = mergeProvenancePartitions(
        partitionProvenanceRefs(left),
        partitionProvenanceRefs(right),
      );
      const guardedResolution = guardedResolutionFor(
        guardedResolutionEvidence,
        provenanceRefs,
      );
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
        evidence,
        ...(guardedResolution ? { guardedResolution } : {}),
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
