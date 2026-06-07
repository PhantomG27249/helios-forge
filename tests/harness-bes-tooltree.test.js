import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backpropagate, selectChild, uctScore } from '../src/harness-sidecar/bes/mctsPolicy.js';
import { planToolTree } from '../src/harness-sidecar/bes/toolTreePlanner.js';

test('UCT policy scores unvisited children first and selects the highest deterministic child', () => {
  assert.equal(uctScore({ visits: 0, value: 0 }, { parentVisits: 10 }), Infinity);

  const children = [
    { nodeId: 'low', visits: 4, value: 1 },
    { nodeId: 'high', visits: 2, value: 3 },
    { nodeId: 'unvisited', visits: 0, value: 0 },
  ];

  assert.equal(selectChild({ children, parentVisits: 6 }).nodeId, 'unvisited');
  assert.equal(selectChild({ children: children.slice(0, 2), parentVisits: 6, exploration: 0 }).nodeId, 'high');
});

test('backpropagate increments visits and value along the selected lineage', () => {
  const root = { nodeId: 'root', visits: 0, value: 0, parent: null };
  const child = { nodeId: 'child', visits: 1, value: 0.25, parent: root };
  const leaf = { nodeId: 'leaf', visits: 0, value: 0, parent: child };

  backpropagate(leaf, 0.75);

  assert.deepEqual(
    [root, child, leaf].map((node) => ({
      nodeId: node.nodeId,
      visits: node.visits,
      value: node.value,
    })),
    [
      { nodeId: 'root', visits: 1, value: 0.75 },
      { nodeId: 'child', visits: 2, value: 1 },
      { nodeId: 'leaf', visits: 1, value: 0.75 },
    ],
  );
});

test('ToolTree planner expands and evaluates deterministic callbacks within iteration and depth budgets', () => {
  const expansions = {
    root: [
      { action: { tool: 'search', query: 'failure' }, state: { key: 'search' } },
      { action: { tool: 'read', path: 'src/server.js' }, state: { key: 'read' } },
    ],
    search: [
      { action: { tool: 'patch', file: 'src/server.js' }, state: { key: 'patch' } },
    ],
    read: [
      { action: { tool: 'inspect', path: 'tests/failing.test.js' }, state: { key: 'inspect' } },
    ],
    patch: [],
    inspect: [],
  };
  const scores = {
    root: 0,
    search: 0.4,
    read: 0.2,
    patch: 0.9,
    inspect: 0.3,
  };

  let tick = 100;
  const result = planToolTree({
    task: 'fix failing server test',
    rootState: { key: 'root' },
    budget: { maxIterations: 4, maxDepth: 2, exploration: 0 },
    now: () => tick++,
    expandNode: ({ state }) => expansions[state.key],
    evaluateNode: ({ state }) => scores[state.key],
  });

  assert.equal(result.task, 'fix failing server test');
  assert.deepEqual(result.budget, {
    maxIterations: 4,
    maxDepth: 2,
    iterationsUsed: 4,
    nodesCreated: 5,
    startedAt: 100,
    finishedAt: 101,
  });

  assert.deepEqual(
    result.plans.map(({ nodeId, parentId, action, depth, visits, value, meanValue, path }) => ({
      nodeId,
      parentId,
      action,
      depth,
      visits,
      value,
      meanValue,
      path,
    })),
    [
      {
        nodeId: 'tooltree_4',
        parentId: 'tooltree_1',
        action: { tool: 'patch', file: 'src/server.js' },
        depth: 2,
        visits: 2,
        value: 1.8,
        meanValue: 0.9,
        path: [
          { nodeId: 'tooltree_1', action: { tool: 'search', query: 'failure' } },
          { nodeId: 'tooltree_4', action: { tool: 'patch', file: 'src/server.js' } },
        ],
      },
      {
        nodeId: 'tooltree_1',
        parentId: 'root',
        action: { tool: 'search', query: 'failure' },
        depth: 1,
        visits: 3,
        value: 2.2,
        meanValue: 0.733333,
        path: [
          { nodeId: 'tooltree_1', action: { tool: 'search', query: 'failure' } },
        ],
      },
      {
        nodeId: 'tooltree_3',
        parentId: 'tooltree_2',
        action: { tool: 'inspect', path: 'tests/failing.test.js' },
        depth: 2,
        visits: 1,
        value: 0.3,
        meanValue: 0.3,
        path: [
          { nodeId: 'tooltree_2', action: { tool: 'read', path: 'src/server.js' } },
          { nodeId: 'tooltree_3', action: { tool: 'inspect', path: 'tests/failing.test.js' } },
        ],
      },
      {
        nodeId: 'tooltree_2',
        parentId: 'root',
        action: { tool: 'read', path: 'src/server.js' },
        depth: 1,
        visits: 1,
        value: 0.3,
        meanValue: 0.3,
        path: [
          { nodeId: 'tooltree_2', action: { tool: 'read', path: 'src/server.js' } },
        ],
      },
    ],
  );

  assert.deepEqual(
    result.events.map((event) => event.type),
    [
      'bes.tooltree_node_selected',
      'bes.tooltree_node_expanded',
      'bes.tooltree_rollout_completed',
      'bes.tooltree_node_selected',
      'bes.tooltree_node_expanded',
      'bes.tooltree_rollout_completed',
      'bes.tooltree_node_selected',
      'bes.tooltree_node_expanded',
      'bes.tooltree_rollout_completed',
      'bes.tooltree_node_selected',
      'bes.tooltree_rollout_completed',
    ],
  );
  assert.equal(result.events[0].at, 100);
  assert.equal(result.events.at(-1).nodeId, 'tooltree_4');
});
