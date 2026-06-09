import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  activateStableSchemas,
  createGlobalMemoryLayers,
  upsertFact,
  upsertPassage,
  upsertSchema,
} from './globalMemoryLayers.js';
import {
  adjudicateMemoryConflict,
  applyConflictDecision,
  detectGlobalMemoryConflicts,
} from './memoryConflictAdjudicator.js';
import { constructMemoryGuidedGraph } from './memoryGraphConstructor.js';

export const MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION = 1;

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function resolveWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function assertInsideWorkspace(workspaceRoot, targetPath) {
  const relative = path.relative(workspaceRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Memory graph runtime path must stay inside workspaceRoot');
  }
}

function runtimePaths(workspaceRoot) {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const memoryDir = path.resolve(resolvedRoot, '.harness', 'memory');
  const layersPath = path.resolve(memoryDir, 'global-layers.json');
  const graphPath = path.resolve(memoryDir, 'global-graph.json');
  assertInsideWorkspace(resolvedRoot, layersPath);
  assertInsideWorkspace(resolvedRoot, graphPath);
  return { memoryDir, layersPath, graphPath };
}

async function readJsonIfPresent(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function withSchemaVersion(layers) {
  return {
    schemaVersion: MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
    ...layers,
    schemas: normalizeList(layers.schemas),
    facts: normalizeList(layers.facts),
    passages: normalizeList(layers.passages),
  };
}

function applyPromotion(layers, promotion = {}, policy = {}) {
  const conflictDecisions = [];

  for (const passage of normalizeList(promotion.passages)) upsertPassage(layers, passage);
  for (const schema of normalizeList(promotion.schemas)) upsertSchema(layers, schema);
  for (const fact of normalizeList(promotion.facts)) {
    const conflicts = detectGlobalMemoryConflicts({ layers, newFact: fact });
    for (const conflict of conflicts) {
      const decision = adjudicateMemoryConflict({
        conflict,
        evidence: fact.passageIds,
        policy,
      });
      conflictDecisions.push(decision);
      applyConflictDecision({ layers, decision });
    }
    upsertFact(layers, { ...fact, status: fact.status || 'pending' });
  }

  return conflictDecisions;
}

export function createMemoryGraphRuntime({
  workspaceRoot,
  schemaThreshold = 2,
  conflictPolicy = {},
  graphOptions = {},
} = {}) {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const paths = runtimePaths(resolvedRoot);

  async function loadLayers() {
    const loaded = await readJsonIfPresent(paths.layersPath, null);
    return withSchemaVersion(createGlobalMemoryLayers(loaded || {}));
  }

  async function loadGraph() {
    return readJsonIfPresent(paths.graphPath, {
      schemaVersion: MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
      nodes: [],
      edges: [],
      stats: {},
    });
  }

  async function saveRuntimeState({ layers, graph }) {
    await mkdir(paths.memoryDir, { recursive: true });
    await writeFile(paths.layersPath, `${JSON.stringify(withSchemaVersion(layers), null, 2)}\n`, 'utf8');
    await writeFile(paths.graphPath, `${JSON.stringify({
      schemaVersion: MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
      ...graph,
    }, null, 2)}\n`, 'utf8');
  }

  async function ingestPromotion(promotion = {}) {
    const layers = await loadLayers();
    const conflictDecisions = applyPromotion(layers, promotion, conflictPolicy);
    const activation = activateStableSchemas({ layers, schemaThreshold });
    const graph = constructMemoryGuidedGraph({ layers, ...graphOptions });

    await saveRuntimeState({ layers, graph });

    return {
      schemaVersion: MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
      layers: withSchemaVersion(layers),
      graph,
      activation,
      conflictDecisions,
      paths,
    };
  }

  return {
    schemaVersion: MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
    workspaceRoot: resolvedRoot,
    paths,
    loadLayers,
    loadGraph,
    ingestPromotion,
  };
}
