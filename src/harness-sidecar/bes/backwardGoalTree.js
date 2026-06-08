function stableString(value) {
  return value === undefined || value === null ? '' : String(value);
}

function safeIdPart(value) {
  return stableString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'goal';
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectCoresetItems(coreset) {
  if (!coreset) return [];
  if (Array.isArray(coreset)) return coreset;
  if (Array.isArray(coreset.items)) return coreset.items;
  if (Array.isArray(coreset.cases)) return coreset.cases;
  if (Array.isArray(coreset.traces)) return coreset.traces;
  return [];
}

function collectFailureModes({ failureModes = [], coreset } = {}) {
  const modes = [...asArray(failureModes)];
  for (const item of collectCoresetItems(coreset)) {
    modes.push(...asArray(item.failureModes));
    if (item.failureMode) modes.push(item.failureMode);
    modes.push(...asArray(item.reasons).filter((reason) => stableString(reason).includes('failure')));
    modes.push(...asArray(item.trace?.failureModes));
    modes.push(...asArray(item.trace?.failures).map((failure) => failure?.category));
    modes.push(...asArray(item.trace?.recoveryEvents).map((event) => event?.category));
  }
  return [...new Set(modes.filter(Boolean).map(safeIdPart))].sort();
}

function isVisualCase(caseRecord = {}) {
  const source = stableString(caseRecord.source);
  const kind = stableString(caseRecord.kind || caseRecord.verifierCase?.kind);
  const reason = stableString(caseRecord.reason || caseRecord.reasons?.[0]);
  const tags = [
    ...asArray(caseRecord.expected?.tags),
    ...asArray(caseRecord.verifierCase?.expected?.tags),
    ...asArray(caseRecord.tags),
  ].map(stableString);
  return (
    source === 'verifier_case' && (
      kind === 'visual' ||
      tags.includes('visual') ||
      tags.includes('vlm') ||
      reason.includes('visual') ||
      asArray(caseRecord.visualArtifacts).length > 0 ||
      asArray(caseRecord.verifierCase?.visualArtifacts).length > 0
    )
  );
}

function collectVisualCases({ visualCases = [], coreset } = {}) {
  const fromCoreset = collectCoresetItems(coreset)
    .filter(isVisualCase)
    .map((item) => item.verifierCase || item);
  return [...asArray(visualCases), ...fromCoreset];
}

function createNode({ id, parentId = 'goal_root', description, weight = 1, check = {}, source = 'generated', depth = 1 }) {
  return {
    id,
    parentId,
    description,
    weight,
    check,
    source,
    depth,
  };
}

export function buildBackwardGoalTree({
  task = {},
  objective,
  failureModes = [],
  coreset,
  visualCases = [],
} = {}) {
  const taskText = objective || task.task || task.objective || 'Complete the task';
  const root = {
    id: 'goal_root',
    parentId: null,
    description: `Satisfy objective: ${taskText}`,
    weight: 0,
    check: { kind: 'objective', taskId: task.taskId },
    source: 'task',
    depth: 0,
  };
  const nodes = [root];

  for (const failureMode of collectFailureModes({ failureModes, coreset })) {
    nodes.push(createNode({
      id: `goal_${failureMode}`,
      description: `Resolve ${failureMode.replace(/_/g, ' ')}`,
      weight: failureMode.includes('verifier') ? 1.25 : 1,
      check: { kind: 'failure_mode', failureMode },
      source: 'rho_failure',
    }));
  }

  const visuals = collectVisualCases({ visualCases, coreset });
  if (visuals.length) {
    nodes.push(createNode({
      id: 'goal_visual_verification',
      description: `Satisfy ${visuals.length} visual/VLM verifier case${visuals.length === 1 ? '' : 's'}`,
      weight: 1.4,
      check: {
        kind: 'visual',
        tags: ['visual', 'vlm'],
        caseIds: visuals.map((item, index) => stableString(item.caseId || item.id || `visual_${index + 1}`)),
      },
      source: 'visual_verifier',
    }));
  }

  const coresetItems = collectCoresetItems(coreset);
  if (coresetItems.length) {
    nodes.push(createNode({
      id: 'goal_rho_coverage',
      description: `Cover ${coresetItems.length} high-signal RHO case${coresetItems.length === 1 ? '' : 's'}`,
      weight: 0.8,
      check: {
        kind: 'rho_coverage',
        caseIds: coresetItems.map((item, index) => stableString(item.caseId || item.id || item.taskId || `rho_${index + 1}`)),
      },
      source: 'rho',
    }));
  }

  const seen = new Set();
  const deduped = nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });

  return {
    root,
    nodes: deduped,
    edges: deduped
      .filter((node) => node.parentId)
      .map((node) => ({ from: node.parentId, to: node.id })),
  };
}
