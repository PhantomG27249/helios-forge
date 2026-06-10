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
  addLocalObservation,
  createLocalMemoryGraph,
} from './localMemoryGraph.js';
import { proposeGlobalMemoryPromotions } from './globalMemoryPromotion.js';
import { mergeSwarmCellMemoryGraphs } from './swarmCellMemoryGraph.js';
import {
  adjudicateMemoryConflict,
  applyConflictDecision,
  detectGlobalMemoryConflicts,
} from './memoryConflictAdjudicator.js';
import { runMemoryExtractionSociety } from './memoryExtractionSociety.js';
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

function uniqueMigrations(...groups) {
  const byId = new Map();
  for (const migration of groups.flatMap(normalizeList)) {
    if (migration?.id && !byId.has(migration.id)) byId.set(migration.id, migration);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function migrationRecord(id, fromVersion, toVersion, target) {
  return {
    id,
    fromVersion,
    toVersion,
    target,
  };
}

function withSchemaVersion(layers) {
  return {
    ...layers,
    schemaVersion: MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
    schemas: normalizeList(layers.schemas),
    facts: normalizeList(layers.facts),
    passages: normalizeList(layers.passages),
    migrationHistory: normalizeList(layers.migrationHistory),
  };
}

function migrateLayers(rawLayers) {
  const migrations = [];
  const fromVersion = rawLayers?.schemaVersion;
  if (rawLayers && fromVersion !== MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION) {
    migrations.push(migrationRecord(
      'global_layers_v0_to_v1',
      fromVersion ?? 0,
      MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
      'global_layers',
    ));
  }
  const layers = createGlobalMemoryLayers(rawLayers || {});
  layers.migrationHistory = uniqueMigrations(rawLayers?.migrationHistory, migrations);
  return {
    layers: withSchemaVersion(layers),
    migrations,
  };
}

function migrateGraph(rawGraph) {
  const migrations = [];
  const fromVersion = rawGraph?.schemaVersion;
  if (rawGraph && fromVersion !== MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION) {
    migrations.push(migrationRecord(
      'global_graph_v0_to_v1',
      fromVersion ?? 0,
      MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
      'global_graph',
    ));
  }
  return {
    graph: {
      schemaVersion: MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
      nodes: normalizeList(rawGraph?.nodes),
      edges: normalizeList(rawGraph?.edges),
      stats: rawGraph?.stats || {},
      migrationHistory: uniqueMigrations(rawGraph?.migrationHistory, migrations),
    },
    migrations,
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
    return migrateLayers(loaded).layers;
  }

  async function loadLayersWithMigrations() {
    const loaded = await readJsonIfPresent(paths.layersPath, null);
    return migrateLayers(loaded);
  }

  async function loadGraph() {
    const loaded = await readJsonIfPresent(paths.graphPath, null);
    return migrateGraph(loaded).graph;
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
    const loadedLayers = await loadLayersWithMigrations();
    const layers = loadedLayers.layers;
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
      migrations: loadedLayers.migrations,
      paths,
    };
  }

  async function ingestObservations({
    agentId,
    cellId = 'memory',
    observations = [],
    supportThreshold = 2,
  } = {}) {
    const extraction = runMemoryExtractionSociety({ observations });
    const localGraph = createLocalMemoryGraph({ agentId });
    for (const observation of normalizeList(observations)) {
      addLocalObservation(localGraph, observation);
    }
    const cellGraph = mergeSwarmCellMemoryGraphs({
      cellId,
      localGraphs: [localGraph],
    });
    const promotion = proposeGlobalMemoryPromotions({
      cellGraph,
      supportThreshold,
    });
    const result = await ingestPromotion(promotion);

    return {
      ...result,
      extraction,
      localGraph,
      cellGraph,
      promotion,
    };
  }

  return {
    schemaVersion: MEMORY_GRAPH_RUNTIME_SCHEMA_VERSION,
    workspaceRoot: resolvedRoot,
    paths,
    loadLayers,
    loadGraph,
    ingestPromotion,
    ingestObservations,
  };
}
