import { createStableArtifactId } from './artifactManifest.js';

function normalizePoint(point) {
  if (Array.isArray(point)) {
    return { x: point[0], y: point[1] };
  }

  return point;
}

function summarizeTrend(points) {
  if (points.length === 0) {
    return { direction: 'flat', delta: 0 };
  }

  const first = points[0].y;
  const last = points[points.length - 1].y;
  const delta = last - first;
  const direction = delta > 0 ? 'increasing' : delta < 0 ? 'decreasing' : 'flat';

  return { direction, delta };
}

export function analyzePlot({ taskId, plotId, title, series = [], statistics = {} } = {}) {
  const normalizedSeries = series.map((item) => ({
    name: item.name,
    points: (item.points || []).map(normalizePoint),
  }));
  const yValues = normalizedSeries.flatMap((item) => item.points.map((point) => point.y));
  const pointsAnalyzed = yValues.length;
  const trends = Object.fromEntries(normalizedSeries.map((item) => [item.name, summarizeTrend(item.points)]));
  const payload = { taskId, plotId, title, series: normalizedSeries, statistics };

  return {
    artifactId: createStableArtifactId('plot_analysis', payload),
    taskId,
    type: 'plot_analysis',
    summary: `Plot "${title || plotId}" has ${series.length} series and ${pointsAnalyzed} points.`,
    observations: {
      title,
      seriesNames: normalizedSeries.map((item) => item.name),
      yRange: {
        min: Math.min(...yValues),
        max: Math.max(...yValues),
      },
      trends,
      statistics,
    },
    evidence: {
      verifier: 'vlm.plot_analyzer',
      status: pointsAnalyzed > 0 ? 'passed' : 'needs_context',
      metrics: {
        seriesCount: normalizedSeries.length,
        pointsAnalyzed,
      },
    },
    visualContext: {
      tokensEstimated: 100 + pointsAnalyzed * 20,
    },
  };
}
