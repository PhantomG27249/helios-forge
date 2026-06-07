import { backpropagate, selectChild } from './mctsPolicy.js';

function normalizeNumber(value) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(6));
}

function cloneAction(action) {
  if (!action || typeof action !== 'object') return action;
  return Array.isArray(action) ? [...action] : { ...action };
}

function createNode({ nodeId, parent = null, action = null, state, depth = 0 }) {
  return {
    nodeId,
    parentId: parent ? parent.nodeId : null,
    parent,
    action,
    state,
    depth,
    children: [],
    expanded: false,
    visits: 0,
    value: 0,
  };
}

function publicNode(node) {
  return {
    nodeId: node.nodeId,
    parentId: node.parentId,
    action: cloneAction(node.action),
    state: node.state,
    depth: node.depth,
    visits: node.visits,
    value: normalizeNumber(node.value),
    meanValue: node.visits ? normalizeNumber(node.value / node.visits) : 0,
  };
}

function planPath(node) {
  const path = [];
  let current = node;

  while (current && current.parent) {
    path.unshift({
      nodeId: current.nodeId,
      action: cloneAction(current.action),
    });
    current = current.parent;
  }

  return path;
}

function evaluateValue(result) {
  if (Number.isFinite(result)) return result;
  if (result && Number.isFinite(result.value)) return result.value;
  if (result && Number.isFinite(result.score)) return result.score;
  return 0;
}

function chooseSelectionRoot(root, { maxDepth, exploration }) {
  let current = root;

  while (current.expanded && current.children.length && current.depth < maxDepth) {
    current = selectChild({
      children: current.children,
      parentVisits: current.visits,
      exploration,
    });
  }

  return current;
}

function expandTreeNode(node, { expandNode, nextNodeId, maxDepth }) {
  if (node.expanded || node.depth >= maxDepth) {
    return [];
  }

  const expansions = expandNode({
    ...publicNode(node),
    path: planPath(node),
  }) || [];

  node.expanded = true;
  node.children = expansions.map((expansion) => createNode({
    nodeId: nextNodeId(),
    parent: node,
    action: expansion.action ?? null,
    state: expansion.state ?? expansion,
    depth: node.depth + 1,
  }));

  return node.children;
}

function snapshotPlan(node) {
  const snapshot = publicNode(node);
  return {
    ...snapshot,
    path: planPath(node),
  };
}

export function planToolTree({
  task,
  rootState,
  budget = {},
  expandNode,
  evaluateNode,
  now = () => Date.now(),
} = {}) {
  if (typeof expandNode !== 'function') {
    throw new TypeError('expandNode callback is required');
  }
  if (typeof evaluateNode !== 'function') {
    throw new TypeError('evaluateNode callback is required');
  }

  const maxIterations = Math.max(0, budget.maxIterations ?? 1);
  const maxDepth = Math.max(0, budget.maxDepth ?? 1);
  const exploration = Number.isFinite(budget.exploration) ? budget.exploration : Math.SQRT2;
  const startedAt = now();
  const events = [];
  const nodes = [];
  let nodeCounter = 0;
  const nextNodeId = () => `tooltree_${++nodeCounter}`;

  const root = createNode({
    nodeId: 'root',
    parent: null,
    action: null,
    state: rootState,
    depth: 0,
  });

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const selected = chooseSelectionRoot(root, { maxDepth, exploration });

    events.push({
      type: 'bes.tooltree_node_selected',
      at: startedAt,
      iteration,
      task,
      nodeId: selected.nodeId,
      parentId: selected.parentId,
      depth: selected.depth,
      action: selected.action,
    });

    const createdChildren = expandTreeNode(selected, {
      expandNode,
      nextNodeId,
      maxDepth,
    });

    for (const child of createdChildren) {
      nodes.push(child);
    }

    if (createdChildren.length) {
      events.push({
        type: 'bes.tooltree_node_expanded',
        at: startedAt,
        iteration,
        task,
        nodeId: selected.nodeId,
        parentId: selected.parentId,
        depth: selected.depth,
        childNodeIds: createdChildren.map((child) => child.nodeId),
      });
    }

    const rolloutNode = createdChildren.length
      ? selectChild({ children: createdChildren, parentVisits: selected.visits, exploration })
      : selected;
    const value = evaluateValue(evaluateNode({
      ...publicNode(rolloutNode),
      path: planPath(rolloutNode),
    }));

    backpropagate(rolloutNode, value);

    events.push({
      type: 'bes.tooltree_rollout_completed',
      at: startedAt,
      iteration,
      task,
      nodeId: rolloutNode.nodeId,
      parentId: rolloutNode.parentId,
      depth: rolloutNode.depth,
      action: rolloutNode.action,
      value: normalizeNumber(value),
    });
  }

  const plans = nodes
    .map(snapshotPlan)
    .sort((left, right) => {
      if (right.meanValue !== left.meanValue) return right.meanValue - left.meanValue;
      if (right.visits !== left.visits) return right.visits - left.visits;
      if (right.depth !== left.depth) return right.depth - left.depth;
      return left.nodeId.localeCompare(right.nodeId);
    });

  return {
    task,
    root: snapshotPlan(root),
    plans,
    selectedPlans: plans,
    budget: {
      maxIterations,
      maxDepth,
      iterationsUsed: maxIterations,
      nodesCreated: nodes.length + 1,
      startedAt,
      finishedAt: now(),
    },
    events,
  };
}
