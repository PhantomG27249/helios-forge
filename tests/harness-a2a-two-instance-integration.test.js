import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { compactA2aLineageForDashboard } from '../src/harness-sidecar/interop/a2aMultiHopLineage.js';
import {
  a2aPeerCycleGatesEnabled,
  runA2aPeerCycle,
} from '../src/harness-sidecar/interop/a2aPeerCycleRunner.js';

async function makeWorkspace(prefix) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  return workspaceRoot;
}

function enabledHarnessConfig() {
  return {
    productionCapabilities: {
      productionA2aTransport: {
        enabled: true,
        mode: 'advisory',
        authority: 'evidence_only',
      },
      productionA2aQueues: {
        enabled: true,
        mode: 'advisory',
        authority: 'evidence_only',
      },
    },
  };
}

test('runA2aPeerCycle skips when A2A production gates are disabled', async () => {
  const localRoot = await makeWorkspace('helios-a2a-local-skip-');
  const peerRoot = await makeWorkspace('helios-a2a-peer-skip-');
  try {
    const result = await runA2aPeerCycle({
      localWorkspaceRoot: localRoot,
      peerWorkspaceRoot: peerRoot,
      harnessConfig: {
        productionCapabilities: {
          productionA2aTransport: { enabled: false, mode: 'offline', authority: 'evidence_only' },
          productionA2aQueues: { enabled: false, mode: 'offline', authority: 'evidence_only' },
        },
      },
    });
    assert.deepEqual(result, { skipped: true, reason: 'a2a_gates_disabled' });
    assert.equal(a2aPeerCycleGatesEnabled({ productionCapabilities: {} }), false);
  } finally {
    await rm(localRoot, { recursive: true, force: true });
    await rm(peerRoot, { recursive: true, force: true });
  }
});

test('runA2aPeerCycle persists peer-cycle artifacts and compacts lineage for dashboard', async () => {
  const localRoot = await makeWorkspace('helios-a2a-local-');
  const peerRoot = await makeWorkspace('helios-a2a-peer-');
  const fixedNow = new Date('2026-06-17T12:00:00.000Z');
  try {
    const harnessConfig = enabledHarnessConfig();
    assert.equal(a2aPeerCycleGatesEnabled(harnessConfig), true);

    const result = await runA2aPeerCycle({
      localWorkspaceRoot: localRoot,
      peerWorkspaceRoot: peerRoot,
      harnessConfig,
      now: () => fixedNow,
    });

    assert.equal(result.skipped, undefined);
    assert.equal(result.canPromote, false);
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.authority, 'evidence_only');
    assert.ok(result.cycleId);
    assert.equal(result.lineage.length, 4);
    assert.equal(result.lineage[0].from, 'agent');
    assert.equal(result.lineage[1].to, 'local-harness');
    assert.equal(result.lineage[2].layer, 'harness');
    assert.equal(result.lineage[3].layer, 'peer');
    assert.equal(result.lineage.every((hop) => hop.trust.canPromote === false), true);
    assert.equal(result.phases.localInboxAck.status, 'acknowledged');

    const localArtifact = path.join(
      localRoot,
      '.harness',
      'a2a',
      'peer-cycles',
      `${result.cycleId}.json`,
    );
    const peerArtifact = path.join(
      peerRoot,
      '.harness',
      'a2a',
      'peer-cycles',
      `${result.cycleId}.json`,
    );
    assert.equal(existsSync(localArtifact), true);
    assert.equal(existsSync(peerArtifact), true);

    const localSummary = JSON.parse(await readFile(localArtifact, 'utf8'));
    const peerSummary = JSON.parse(await readFile(peerArtifact, 'utf8'));

    for (const summary of [localSummary, peerSummary]) {
      assert.equal(summary.canPromote, false);
      assert.equal(summary.evidenceOnly, true);
      assert.equal(summary.authority, 'evidence_only');
      assert.equal(summary.cycleId, result.cycleId);
      assert.equal(summary.lineageCompact.hopCount, 4);
      assert.equal(summary.phases.localInboxAck.status, 'acknowledged');
      assert.equal(summary.phases.peerInboxHydrate.status, 'hydrated');
      assert.equal(JSON.stringify(summary).includes('ghp_should_not_leak'), false);
    }

    assert.equal(localSummary.role, 'local');
    assert.equal(peerSummary.role, 'peer');

    const compacted = compactA2aLineageForDashboard(localSummary.lineage);
    assert.equal(compacted.hopCount, 4);
    assert.deepEqual(compacted.messageIds, result.lineageCompact.messageIds);
    assert.equal(compacted.hops.every((hop) => hop.trust.canPromote === false), true);
    assert.equal(compacted.hops.every((hop) => hop.trust.authority === 'evidence_only'), true);
    assert.equal(JSON.stringify(compacted).includes('token='), false);
  } finally {
    await rm(localRoot, { recursive: true, force: true });
    await rm(peerRoot, { recursive: true, force: true });
  }
});
