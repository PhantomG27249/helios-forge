import { GraphStore } from './graphStore.js';
import { createProvenance } from './provenance.js';

function prefixedId(type, value) {
  const text = String(value || '');
  return text.startsWith(`${type}:`) ? text : `${type}:${text}`;
}

export function buildVisualGraph({
  graph = new GraphStore(),
  taskId = 'visual_graph',
  artifact,
  sourceFiles = [],
  figures = [],
  screenshots = [],
  observations = [],
} = {}) {
  const artifactPath = artifact?.path || artifact?.id;
  const artifactId = prefixedId('artifact', artifactPath);
  const provenance = [createProvenance({
    taskId,
    path: artifactPath,
    reason: 'visual graph link',
    sourceType: 'knowledge_graph',
  })];

  graph.upsertNode({
    id: artifactId,
    type: 'artifact',
    label: artifact?.label || artifactPath,
    path: artifactPath,
    provenance,
  });

  for (const path of sourceFiles) {
    const fileId = prefixedId('file', path);
    graph.upsertNode({ id: fileId, type: 'file', label: path, path, provenance });
    graph.upsertEdge({ from: artifactId, to: fileId, type: 'visualizes_source', provenance });
  }

  for (const figure of figures) {
    const figureId = prefixedId('figure', figure.id || figure.label);
    graph.upsertNode({ id: figureId, type: 'figure', label: figure.label || figure.id, provenance });
    graph.upsertEdge({ from: artifactId, to: figureId, type: 'contains_figure', provenance });
  }

  for (const screenshot of screenshots) {
    const screenshotPath = screenshot.path || screenshot.id;
    const screenshotId = prefixedId('screenshot', screenshotPath);
    graph.upsertNode({
      id: screenshotId,
      type: 'screenshot',
      label: screenshot.label || screenshotPath,
      path: screenshotPath,
      provenance,
    });
    graph.upsertEdge({ from: artifactId, to: screenshotId, type: 'has_screenshot', provenance });
  }

  for (const observation of observations) {
    const observationId = prefixedId('observation', observation.id || observation.text);
    graph.upsertNode({
      id: observationId,
      type: 'observation',
      label: observation.text || observation.id,
      provenance,
    });
    graph.upsertEdge({ from: observationId, to: artifactId, type: 'observed_on', provenance });
  }

  return graph;
}
