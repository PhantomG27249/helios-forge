import { createStableArtifactId } from './artifactManifest.js';

function nodeLabel(node) {
  return node.label || node.id;
}

export function interpretDiagram({ taskId, diagramId, nodes = [], edges = [], text = [] } = {}) {
  const labelsById = new Map(nodes.map((node) => [node.id, nodeLabel(node)]));
  const flows = edges.map((edge) => {
    const from = labelsById.get(edge.from) || edge.from;
    const to = labelsById.get(edge.to) || edge.to;
    return edge.label ? `${from} -> ${to} (${edge.label})` : `${from} -> ${to}`;
  });
  const payload = { taskId, diagramId, nodes, edges, text };

  return {
    artifactId: createStableArtifactId('diagram_interpretation', payload),
    taskId,
    type: 'diagram_interpretation',
    summary: `Diagram "${diagramId}" has ${nodes.length} nodes, ${edges.length} edges, and ${text.length} text annotations.`,
    observations: {
      nodeLabels: nodes.map(nodeLabel),
      nodeTypes: Object.fromEntries(nodes.map((node) => [node.id, node.type || 'unknown'])),
      flows,
      textAnnotations: text,
    },
    evidence: {
      verifier: 'vlm.diagram_interpreter',
      status: nodes.length || edges.length || text.length ? 'passed' : 'needs_context',
      metrics: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        textAnnotationCount: text.length,
      },
    },
    visualContext: {
      tokensEstimated: 100 + nodes.length * 20 + edges.length * 12 + text.length * 6,
    },
  };
}
