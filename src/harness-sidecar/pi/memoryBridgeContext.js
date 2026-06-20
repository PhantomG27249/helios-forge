import { composeGraphRagContext } from '../rag/graphRagComposer.js';

const DEFAULT_MAX_CHARS = 1024;

function truncate(text, maxChars = DEFAULT_MAX_CHARS) {
  const body = String(text || '');
  if (body.length <= maxChars) return body;
  return `${body.slice(0, Math.max(0, maxChars - 3))}...`;
}

function summarizeItems(items = []) {
  if (!items.length) return '';
  const labels = items.slice(0, 8).map((item) => item.label || item.id || item.path).filter(Boolean);
  return labels.length ? labels.join(', ') : `${items.length} graph item(s)`;
}

export async function loadMemoryBridgeContext({
  workspaceRoot,
  harnessConfig = {},
  task = {},
  deps = {},
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  if (harnessConfig?.features?.localMemoryGraph === false) {
    return null;
  }

  const compose = deps.composeGraphRagContext || composeGraphRagContext;
  const graph = deps.graph ?? task?.graph ?? null;
  const queries = deps.queries ?? [];

  try {
    const composed = compose({
      graph,
      queries,
      maxItems: 6,
    });
    const items = Array.isArray(composed?.items) ? composed.items : [];
    const summary = truncate(summarizeItems(items));

    return {
      itemCount: items.length,
      summary: summary || null,
      provenanceIds: items.slice(0, 8).map((item) => item.id).filter(Boolean),
      evidenceOnly: true,
      canPromote: false,
      authority: 'advisory_only',
    };
  } catch {
    return {
      itemCount: 0,
      summary: null,
      provenanceIds: [],
      evidenceOnly: true,
      canPromote: false,
      authority: 'advisory_only',
    };
  }
}
