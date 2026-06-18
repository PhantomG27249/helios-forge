import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  applyRuntimePolicyToHarnessConfig,
  computeAdaptiveSearchActionDelta,
  resolveEffectiveAutonomyLevel,
} from '../src/harness-sidecar/meta/runtimePolicyConsumer.js';
import {
  LIVE_POLICY_REL,
  SHADOW_POLICY_REL,
  loadRuntimePolicy,
  mergeRuntimePolicyDocuments,
} from '../src/harness-sidecar/meta/runtimePolicyStore.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-runtime-policy-'));
  await mkdir(path.join(workspaceRoot, '.harness', 'runtime'), { recursive: true });
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

const baseHarnessConfig = {
  adaptiveSearch: {
    mode: 'advisory',
    maxActionsPerTask: 8,
    allowProfileSwitching: true,
  },
  icr: {
    enabled: true,
    branchBreadth: 5,
    correctionDepth: 10,
  },
  partialAutonomy: {
    enabled: true,
    maxLevel: 2,
  },
};

test('mergeRuntimePolicyDocuments prefers live policy over shadow fields', () => {
  const merged = mergeRuntimePolicyDocuments({
    shadow: {
      schemaVersion: 1,
      policyHints: { reportId: 'shadow-1', aggregateScore: 0.05 },
      partialAutonomy: { level: 1, levelName: 'shadow' },
      evidenceOnly: true,
    },
    live: {
      schemaVersion: 1,
      policyHints: { reportId: 'live-1', aggregateScore: 0.12 },
      partialAutonomy: { level: 3, levelName: 'reversible' },
      harnessAdjustments: {
        adaptiveSearch: { maxActionsPerTask: 10 },
      },
      evidenceOnly: false,
    },
  });

  assert.equal(merged.policyHints.reportId, 'live-1');
  assert.equal(merged.policyHints.aggregateScore, 0.12);
  assert.equal(merged.partialAutonomy.level, 3);
  assert.equal(merged.harnessAdjustments.adaptiveSearch.maxActionsPerTask, 10);
  assert.deepEqual(merged.sources, { shadow: true, live: true });
});

test('loadRuntimePolicy merges shadow-policy.json and optional live-policy.json', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const runtimeDir = path.join(workspaceRoot, '.harness', 'runtime');
    await writeFile(path.join(runtimeDir, 'shadow-policy.json'), `${JSON.stringify({
      schemaVersion: 1,
      policyHints: { reportId: 'shadow-only', aggregateScore: 0.04 },
      partialAutonomy: { level: 1, levelName: 'shadow' },
      evidenceOnly: true,
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(runtimeDir, 'live-policy.json'), `${JSON.stringify({
      schemaVersion: 1,
      policyHints: { reportId: 'live-win', aggregateScore: 0.11 },
      partialAutonomy: { level: 3, levelName: 'reversible' },
      harnessAdjustments: { icr: { branchBreadth: 4 } },
      evidenceOnly: false,
    }, null, 2)}\n`, 'utf8');

    const policy = await loadRuntimePolicy({ workspaceRoot });

    assert.equal(policy.policyHints.reportId, 'live-win');
    assert.equal(policy.policyHints.aggregateScore, 0.11);
    assert.equal(policy.partialAutonomy.level, 3);
    assert.equal(policy.harnessAdjustments.icr.branchBreadth, 4);
    assert.equal(policy.shadowPolicyPath.endsWith(SHADOW_POLICY_REL.replace(/^\./, '')), false);
    assert.match(policy.shadowPolicyPath, /shadow-policy\.json$/);
    assert.match(policy.livePolicyPath, /live-policy\.json$/);
    assert.deepEqual(policy.sources, { shadow: true, live: true });
  });
});

test('loadRuntimePolicy returns shadow-only document when live-policy.json is missing', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const runtimeDir = path.join(workspaceRoot, '.harness', 'runtime');
    await writeFile(path.join(runtimeDir, 'shadow-policy.json'), `${JSON.stringify({
      schemaVersion: 1,
      policyHints: { reportId: 'shadow-only', aggregateScore: 0.02 },
      partialAutonomy: { level: 1, levelName: 'shadow' },
    }, null, 2)}\n`, 'utf8');

    const policy = await loadRuntimePolicy({ workspaceRoot });

    assert.equal(policy.policyHints.reportId, 'shadow-only');
    assert.deepEqual(policy.sources, { shadow: true, live: false });
  });
});

test('computeAdaptiveSearchActionDelta is bounded from replay aggregateScore', () => {
  assert.equal(computeAdaptiveSearchActionDelta(0.15), 2);
  assert.equal(computeAdaptiveSearchActionDelta(0.05), 1);
  assert.equal(computeAdaptiveSearchActionDelta(-0.25), -2);
  assert.equal(computeAdaptiveSearchActionDelta(0.9), 2);
  assert.equal(computeAdaptiveSearchActionDelta(undefined), 0);
});

test('applyRuntimePolicyToHarnessConfig adjusts maxActionsPerTask with bounded delta', () => {
  const policy = {
    policyHints: { aggregateScore: 0.12 },
    partialAutonomy: { level: 2, levelName: 'advisory' },
  };

  const result = applyRuntimePolicyToHarnessConfig(baseHarnessConfig, policy);

  assert.equal(result.harnessConfig.adaptiveSearch.maxActionsPerTask, 9);
  assert.equal(baseHarnessConfig.adaptiveSearch.maxActionsPerTask, 8);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.autonomyLevel, 2);
});

test('applyRuntimePolicyToHarnessConfig caps ICR breadth and depth by partialAutonomy.maxLevel', () => {
  const policy = {
    policyHints: { aggregateScore: 0.05 },
    partialAutonomy: { level: 3, levelName: 'reversible' },
    harnessAdjustments: {
      icr: { branchBreadth: 5, correctionDepth: 10 },
    },
  };

  const result = applyRuntimePolicyToHarnessConfig({
    ...baseHarnessConfig,
    partialAutonomy: { enabled: true, maxLevel: 2 },
  }, policy);

  assert.equal(result.harnessConfig.icr.branchBreadth, 4);
  assert.equal(result.harnessConfig.icr.correctionDepth, 8);
  assert.equal(result.advisoryOnly, true);
  assert.equal(resolveEffectiveAutonomyLevel(policy, { partialAutonomy: { maxLevel: 2 } }), 2);
});

test('applyRuntimePolicyToHarnessConfig returns advisoryOnly false at L3+ within maxLevel', () => {
  const policy = {
    policyHints: { aggregateScore: 0.08 },
    partialAutonomy: { level: 3, levelName: 'reversible' },
    harnessAdjustments: {
      adaptiveSearch: { maxActionsPerTask: 11 },
      icr: { branchBreadth: 5, correctionDepth: 10 },
    },
  };

  const result = applyRuntimePolicyToHarnessConfig({
    ...baseHarnessConfig,
    partialAutonomy: { enabled: true, maxLevel: 3 },
  }, policy);

  assert.equal(result.advisoryOnly, false);
  assert.equal(result.harnessConfig.adaptiveSearch.maxActionsPerTask, 11);
  assert.equal(result.harnessConfig.icr.branchBreadth, 5);
  assert.equal(result.harnessConfig.icr.correctionDepth, 10);
});

test('applyRuntimePolicyToHarnessConfig never mutates the input harness config', () => {
  const frozen = structuredClone(baseHarnessConfig);
  const policy = {
    policyHints: { aggregateScore: -0.2 },
    partialAutonomy: { level: 2, levelName: 'advisory' },
  };

  applyRuntimePolicyToHarnessConfig(frozen, policy);

  assert.deepEqual(frozen, baseHarnessConfig);
});

test('loadRuntimePolicy is read-only and never writes under src/', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    const runtimeDir = path.join(workspaceRoot, '.harness', 'runtime');
    await writeFile(path.join(runtimeDir, 'shadow-policy.json'), `${JSON.stringify({
      policyHints: { aggregateScore: 0.03 },
      partialAutonomy: { level: 1 },
    }, null, 2)}\n`, 'utf8');

    await loadRuntimePolicy({ workspaceRoot });

    await assert.rejects(async () => readFile(path.join(workspaceRoot, 'src', 'probe.txt'), 'utf8'));
  });
});
