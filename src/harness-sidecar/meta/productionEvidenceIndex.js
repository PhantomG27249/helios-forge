import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const EVIDENCE_ONLY_FLAGS = Object.freeze({
  evidenceOnly: true,
  canPromote: false,
});

const HARNESS_REL = '.harness';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function harnessPath(workspaceRoot, ...segments) {
  return path.join(resolveWorkspaceRoot(workspaceRoot), HARNESS_REL, ...segments);
}

function extractTimestamp(record = {}) {
  const candidates = [
    record.updatedAt,
    record.generatedAt,
    record.createdAt,
    record.completedAt,
    record.timestamp,
    record.tickId,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

function latestTimestamp(...values) {
  const timestamps = values.filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

async function readJsonFileIfPresent(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJsonDirectory(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries
      .filter((item) => item.isFile() && item.name.endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(dirPath, entry.name);
      const raw = await readFile(filePath, 'utf8');
      const content = JSON.parse(raw);
      items.push({
        filePath,
        fileName: entry.name,
        content,
        updatedAt: extractTimestamp(content),
      });
    }
    return items;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function hasFrontierLane(snapshot = {}) {
  const frontier = snapshot.frontier;
  if (!frontier || typeof frontier !== 'object') return false;
  if (frontier.status && frontier.status !== 'unavailable') return true;
  if (Array.isArray(frontier.items) && frontier.items.length > 0) return true;
  return Object.keys(frontier).some((key) => key !== 'status');
}

function hasLongitudinalTrend(report = {}) {
  if (report.evidenceType === 'longitudinal_improvement_trend') return true;
  const trend = report.longitudinalTrend;
  if (!trend || typeof trend !== 'object') return false;
  return trend.evidenceType === 'longitudinal_improvement_trend'
    || trend.history?.length > 0
    || trend.latestImprovementDelta !== undefined;
}

function hasBackgroundTickRecord(record = {}) {
  if (record.tickId || record.lastBackgroundTick || record.backgroundTick) return true;
  if (record.lastTickAt || record.lastResult?.tickId) return true;
  return Object.keys(record).length > 0;
}

const PRODUCTION_TO_SUBSTRATE_EVIDENCE = Object.freeze({
  persisted_replay_report: ['held_out_suite', 'repeated_cycle'],
  operator_dashboard_snapshot: ['budget_accounting'],
  frontier_dashboard_snapshot: ['frontier_trend'],
  persisted_campaign_report: [
    'isolated_variant',
    'source_artifact',
    'trace_artifact',
    'metric_artifact',
    'proposer_context',
  ],
  production_grouped_reroll_report: [
    'grouped_reroll',
    'embedding_diversity',
    'candidate_family_delta',
    'self_preference_signal',
  ],
  live_lane_report: [
    'forward_backward_fusion',
    'dense_verifier',
    'trajectory_provenance',
    'family_recombination',
    'champion_frontier',
  ],
  provenance_resolution_report: [
    'role_pipeline',
    'provenance_retrieval',
    'conflict_adjudication',
    'migration_record',
    'eval_signal',
  ],
  visual_replay_report: [
    'visual_benchmark_case',
    'visual_memory_node',
    'visual_rho_case',
    'visual_policy_gate',
    'vlm_budget_route',
  ],
  external_peer_status: ['endpoint_contract', 'peer_negotiation', 'multi_hop_lineage'],
  durable_queue_snapshot: ['persistent_queue', 'issuer_secret'],
  background_tick_record: [
    'background_tick_record',
    'recursive_replay_evidence',
    'recursive_campaign_evidence',
  ],
});

function createSignalAccumulator() {
  const signals = new Map();

  function add(goalId, productionEvidenceType, updatedAt = null) {
    const normalizedGoalId = String(goalId || '').trim();
    const normalizedEvidence = String(productionEvidenceType || '').trim();
    if (!normalizedGoalId || !normalizedEvidence) return;

    let signal = signals.get(normalizedGoalId);
    if (!signal) {
      signal = {
        goalId: normalizedGoalId,
        evidence: [],
        productionEvidence: [],
        blockers: [],
        persistedProductionEvidence: false,
        updatedAt: null,
        ...EVIDENCE_ONLY_FLAGS,
      };
      signals.set(normalizedGoalId, signal);
    }

    if (!signal.productionEvidence.includes(normalizedEvidence)) {
      signal.productionEvidence.push(normalizedEvidence);
    }

    for (const substrateType of PRODUCTION_TO_SUBSTRATE_EVIDENCE[normalizedEvidence] || []) {
      if (!signal.evidence.includes(substrateType)) {
        signal.evidence.push(substrateType);
      }
    }

    signal.persistedProductionEvidence = signal.productionEvidence.length > 0;
    signal.updatedAt = latestTimestamp(signal.updatedAt, updatedAt);
  }

  return {
    add,
    values() {
      return [...signals.values()].map((signal) => ({
        ...signal,
        evidence: [...signal.evidence].sort(),
        productionEvidence: [...signal.productionEvidence].sort(),
      }));
    },
  };
}

export async function scanPersistedArtifacts(workspaceRoot) {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);

  const [
    replayCycles,
    operatorDashboards,
    campaignReports,
    groupedRerolls,
    liveLanes,
    provenanceResolution,
    visualReplay,
    peerCycles,
    icrFamilies,
    backgroundTicks,
  ] = await Promise.all([
    readJsonDirectory(harnessPath(resolvedRoot, 'benchmarks', 'replay-cycles')),
    readJsonDirectory(harnessPath(resolvedRoot, 'dashboards', 'operator')),
    readJsonDirectory(harnessPath(resolvedRoot, 'meta', 'campaign-reports')),
    readJsonDirectory(harnessPath(resolvedRoot, 'rho', 'production-grouped-rerolls')),
    readJsonDirectory(harnessPath(resolvedRoot, 'bes', 'production-live-lanes')),
    readJsonDirectory(harnessPath(resolvedRoot, 'memory', 'provenance-resolution')),
    readJsonDirectory(harnessPath(resolvedRoot, 'visual', 'production-replay')),
    readJsonDirectory(harnessPath(resolvedRoot, 'a2a', 'peer-cycles')),
    readJsonDirectory(harnessPath(resolvedRoot, 'icr', 'families')),
    readJsonDirectory(harnessPath(resolvedRoot, 'meta', 'background-ticks')),
  ]);

  const [
    productionQueues,
    autonomySummary,
    rollbackDrills,
    autonomyEvidence,
    frontierDashboardJson,
  ] = await Promise.all([
    readJsonFileIfPresent(harnessPath(resolvedRoot, 'interop', 'production-queues.json')),
    readJsonFileIfPresent(harnessPath(resolvedRoot, 'governance', 'autonomy-summary.json')),
    readJsonFileIfPresent(harnessPath(resolvedRoot, 'governance', 'rollback-drills.json')),
    readJsonFileIfPresent(harnessPath(resolvedRoot, 'meta', 'autonomy-evidence.json')),
    readJsonFileIfPresent(harnessPath(resolvedRoot, 'benchmarks', 'frontier-dashboard.json')),
  ]);

  let frontierDashboardJsonl = [];
  try {
    const raw = await readFile(harnessPath(resolvedRoot, 'benchmarks', 'frontier-dashboard.jsonl'), 'utf8');
    frontierDashboardJsonl = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  return {
    replayCycles,
    operatorDashboards,
    campaignReports,
    groupedRerolls,
    liveLanes,
    provenanceResolution,
    visualReplay,
    peerCycles,
    icrFamilies,
    backgroundTicks,
    productionQueues,
    autonomySummary,
    rollbackDrills,
    autonomyEvidence,
    frontierDashboardJsonl,
    frontierDashboardJson,
  };
}

export async function buildCapabilitySignalFromArtifacts({ workspaceRoot, artifacts } = {}) {
  const scanned = artifacts || await scanPersistedArtifacts(workspaceRoot);
  const accumulator = createSignalAccumulator();

  for (const entry of asArray(scanned.replayCycles)) {
    accumulator.add('benchmark_spine', 'persisted_replay_report', entry.updatedAt);
  }

  for (const entry of asArray(scanned.operatorDashboards)) {
    accumulator.add('benchmark_spine', 'operator_dashboard_snapshot', entry.updatedAt);
    if (hasFrontierLane(entry.content)) {
      accumulator.add('benchmark_spine', 'frontier_dashboard_snapshot', entry.updatedAt);
      accumulator.add('meta_harness_loop', 'frontier_dashboard_snapshot', entry.updatedAt);
    }
  }

  for (const entry of asArray(scanned.frontierDashboardJsonl)) {
    accumulator.add('benchmark_spine', 'frontier_dashboard_snapshot', extractTimestamp(entry));
    accumulator.add('meta_harness_loop', 'frontier_dashboard_snapshot', extractTimestamp(entry));
  }

  if (scanned.frontierDashboardJson) {
    const frontierAt = extractTimestamp(scanned.frontierDashboardJson);
    accumulator.add('benchmark_spine', 'frontier_dashboard_snapshot', frontierAt);
    accumulator.add('meta_harness_loop', 'frontier_dashboard_snapshot', frontierAt);
  }

  for (const entry of asArray(scanned.campaignReports)) {
    accumulator.add('meta_harness_loop', 'persisted_campaign_report', entry.updatedAt);
  }

  for (const entry of asArray(scanned.groupedRerolls)) {
    const report = entry.content || {};
    accumulator.add('rho_at_scale', 'production_grouped_reroll_report', entry.updatedAt);
    if (hasLongitudinalTrend(report)) {
      accumulator.add('rho_at_scale', 'longitudinal_improvement_trend', entry.updatedAt);
    }
  }

  for (const entry of asArray(scanned.liveLanes)) {
    accumulator.add('bes_full_lanes', 'live_lane_report', entry.updatedAt);
  }

  for (const entry of asArray(scanned.provenanceResolution)) {
    accumulator.add('memgraphrag_depth', 'provenance_resolution_report', entry.updatedAt);
  }

  for (const entry of asArray(scanned.visualReplay)) {
    accumulator.add('multimodal_system_sense', 'visual_replay_report', entry.updatedAt);
  }

  for (const entry of asArray(scanned.peerCycles)) {
    accumulator.add('a2a_external_durability', 'external_peer_status', entry.updatedAt);
  }

  if (scanned.productionQueues) {
    accumulator.add(
      'a2a_external_durability',
      'durable_queue_snapshot',
      extractTimestamp(scanned.productionQueues),
    );
  }

  if (scanned.autonomySummary) {
    accumulator.add(
      'governance_autonomy',
      'autonomy_dashboard_snapshot',
      extractTimestamp(scanned.autonomySummary),
    );
  }

  if (scanned.rollbackDrills) {
    accumulator.add(
      'governance_autonomy',
      'rollback_drill_report',
      extractTimestamp(scanned.rollbackDrills),
    );
  }

  for (const entry of asArray(scanned.backgroundTicks)) {
    accumulator.add('background_evolution', 'background_tick_record', entry.updatedAt);
  }

  if (scanned.autonomyEvidence && hasBackgroundTickRecord(scanned.autonomyEvidence)) {
    accumulator.add(
      'background_evolution',
      'background_tick_record',
      extractTimestamp(scanned.autonomyEvidence),
    );
  }

  return accumulator.values();
}

export async function loadPersistedProductionSignals({ workspaceRoot } = {}) {
  const artifacts = await scanPersistedArtifacts(workspaceRoot);
  const signals = await buildCapabilitySignalFromArtifacts({ artifacts });
  const icrEvidence = asArray(artifacts.icrFamilies)
    .map((entry) => entry.content)
    .filter((record) => record && typeof record === 'object');

  return {
    signals,
    icrEvidence,
    ...EVIDENCE_ONLY_FLAGS,
  };
}
