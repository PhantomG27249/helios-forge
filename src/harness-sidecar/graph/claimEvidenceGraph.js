import { GraphStore } from './graphStore.js';
import { createProvenance } from './provenance.js';

function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function prefixedId(type, value) {
  const text = String(value || '');
  return text.startsWith(`${type}:`) ? text : `${type}:${text}`;
}

function evidenceNode(evidence) {
  const type = evidence.type || 'artifact';
  const rawId = evidence.path || evidence.id || evidence.name || evidence.summary;
  return {
    id: prefixedId(type, rawId),
    type,
    label: evidence.summary || evidence.label || evidence.path || evidence.id || rawId,
    path: evidence.path,
    value: evidence.value,
  };
}

export function buildClaimEvidenceGraph({ graph = new GraphStore(), taskId = 'claim_graph', claims = [] } = {}) {
  for (const claim of claims) {
    const claimKey = claim.id || slug(claim.text);
    const claimId = prefixedId('claim', claimKey);
    const provenance = [createProvenance({
      taskId,
      path: claim.path,
      reason: 'claim evidence link',
      sourceType: 'knowledge_graph',
    })];

    graph.upsertNode({
      id: claimId,
      type: 'claim',
      label: claim.text || claim.summary || claimKey,
      provenance,
    });

    for (const evidence of claim.evidence || []) {
      const node = evidenceNode(evidence);
      graph.upsertNode({
        ...node,
        provenance,
      });
      graph.upsertEdge({
        from: claimId,
        to: node.id,
        type: 'supported_by',
        provenance,
      });
    }
  }

  return graph;
}
