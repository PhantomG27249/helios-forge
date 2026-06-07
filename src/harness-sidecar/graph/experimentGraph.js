import { GraphStore } from './graphStore.js';
import { createProvenance } from './provenance.js';

function prefixedId(type, value) {
  const text = String(value || '');
  return text.startsWith(`${type}:`) ? text : `${type}:${text}`;
}

export function buildExperimentGraph({
  graph = new GraphStore(),
  taskId = 'experiment_graph',
  hypothesis,
  config,
  runs = [],
  decision,
} = {}) {
  const provenance = [createProvenance({
    taskId,
    path: config?.path || decision?.path,
    reason: 'experiment graph link',
    sourceType: 'knowledge_graph',
  })];

  const hypothesisId = hypothesis ? prefixedId('hypothesis', hypothesis.id || hypothesis.text) : null;
  const configId = config ? prefixedId('config', config.id || config.name) : null;

  if (hypothesisId) {
    graph.upsertNode({
      id: hypothesisId,
      type: 'hypothesis',
      label: hypothesis.text || hypothesis.id,
      provenance,
    });
  }

  if (configId) {
    graph.upsertNode({
      id: configId,
      type: 'config',
      label: config.label || config.id,
      params: config.params || {},
      provenance,
    });
  }

  if (hypothesisId && configId) {
    graph.upsertEdge({ from: hypothesisId, to: configId, type: 'tested_by_config', provenance });
  }

  for (const run of runs) {
    const runId = prefixedId('run', run.id || run.runId);
    graph.upsertNode({
      id: runId,
      type: 'run',
      label: run.summary || run.id || run.runId,
      status: run.status,
      provenance,
    });

    if (configId) {
      graph.upsertEdge({ from: configId, to: runId, type: 'produced_run', provenance });
    }

    for (const metric of run.metrics || []) {
      const metricName = metric.name || metric.id;
      const metricId = prefixedId('metric', `${run.id || run.runId}:${metricName}`);
      graph.upsertNode({
        id: metricId,
        type: 'metric',
        label: metricName,
        value: metric.value,
        provenance,
      });
      graph.upsertEdge({ from: runId, to: metricId, type: 'recorded_metric', provenance });
    }
  }

  if (decision) {
    const decisionId = prefixedId('decision', decision.id || decision.outcome);
    graph.upsertNode({
      id: decisionId,
      type: 'decision',
      label: decision.outcome || decision.id,
      reason: decision.reason,
      provenance,
    });

    for (const run of runs) {
      graph.upsertEdge({
        from: decisionId,
        to: prefixedId('run', run.id || run.runId),
        type: 'based_on_run',
        provenance,
      });
    }
  }

  return graph;
}
