import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  applyPartialAutonomousImprovements,
  extractPolicyHintsFromReplayReport,
  partialAutonomyEnabled,
} from '../src/harness-sidecar/meta/partialAutonomyApply.js';
import {
  defaultPartialAutonomyThresholds,
  runAutonomyApplyOrchestrator,
} from '../src/harness-sidecar/meta/postTaskAutonomyApply.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-partial-autonomy-'));
  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

const enabledConfig = {
  productionCapabilities: {
    backgroundEvolution: { enabled: true },
  },
  partialAutonomy: { enabled: true },
};

test('partialAutonomyEnabled defaults to background evolution flag', () => {
  assert.equal(partialAutonomyEnabled({}), false);
  assert.equal(partialAutonomyEnabled({
    productionCapabilities: { backgroundEvolution: { enabled: true } },
  }), true);
  assert.equal(partialAutonomyEnabled({
    productionCapabilities: { backgroundEvolution: { enabled: true } },
    partialAutonomy: { enabled: false },
  }), false);
});

test('extractPolicyHintsFromReplayReport preserves evidence-only authority', () => {
  const hints = extractPolicyHintsFromReplayReport({
    reportId: 'replay-1',
    suiteId: 'code-smoke',
    aggregateScore: 0.05,
    domainScores: { code: { delta: 0.05 } },
    regressions: [],
    rollbackDrillRequired: false,
  });

  assert.equal(hints.reportId, 'replay-1');
  assert.equal(hints.regressionCount, 0);
  assert.equal(hints.evidenceOnly, true);
  assert.equal(hints.canPromote, false);
});

test('applyPartialAutonomousImprovements writes ledger and shadow policy in safe scope', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const events = [];
    const result = await applyPartialAutonomousImprovements({
      workspaceRoot,
      harnessConfig: enabledConfig,
      autonomyState: { dashboardDepth: 2, regressionCount: 0 },
      replayReports: [{
        reportId: 'replay-safe-1',
        suiteId: 'code-smoke',
        aggregateScore: 0.1,
        domainScores: { code: { delta: 0.1 } },
        regressions: [],
      }],
      emitEvent: async (event) => { events.push(event); },
      now: () => new Date('2026-06-17T12:00:00.000Z'),
    });

    assert.equal(result.applied, true);
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.match(result.shadowPolicyPath, /shadow-policy\.json$/);
    assert.match(result.ledgerPath, /partial-autonomy-applied\.json$/);

    const shadowPolicy = JSON.parse(await readFile(result.shadowPolicyPath, 'utf8'));
    assert.equal(shadowPolicy.policyHints.reportId, 'replay-safe-1');
    assert.equal(shadowPolicy.partialAutonomy.level, 1);
    assert.equal(shadowPolicy.canPromote, false);

    const ledger = JSON.parse(await readFile(result.ledgerPath, 'utf8'));
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].replayReportId, 'replay-safe-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'partial_autonomy.applied');
  });
});

test('applyPartialAutonomousImprovements merges hints into existing shadow policy', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const shadowPath = path.join(workspaceRoot, '.harness', 'runtime', 'shadow-policy.json');
    await mkdir(path.dirname(shadowPath), { recursive: true });
    await writeFile(shadowPath, `${JSON.stringify({
      schemaVersion: 1,
      policyHints: { reportId: 'replay-old', aggregateScore: 0.01 },
      evidenceOnly: true,
      canPromote: false,
    }, null, 2)}\n`, 'utf8');

    await applyPartialAutonomousImprovements({
      workspaceRoot,
      harnessConfig: enabledConfig,
      autonomyState: { dashboardDepth: 1, regressionCount: 0 },
      replayReports: [{
        reportId: 'replay-new',
        suiteId: 'code-smoke',
        aggregateScore: 0.2,
        regressions: [],
      }],
      now: () => new Date('2026-06-17T13:00:00.000Z'),
    });

    const shadowPolicy = JSON.parse(await readFile(shadowPath, 'utf8'));
    assert.equal(shadowPolicy.policyHints.reportId, 'replay-new');
    assert.equal(shadowPolicy.policyHints.aggregateScore, 0.2);
  });
});

test('applyPartialAutonomousImprovements skips when partial autonomy disabled', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await applyPartialAutonomousImprovements({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: { backgroundEvolution: { enabled: true } },
        partialAutonomy: { enabled: false },
      },
      autonomyState: { dashboardDepth: 1, regressionCount: 0 },
      replayReports: [{ reportId: 'replay-skipped', regressions: [] }],
    });

    assert.equal(result.applied, false);
    assert.equal(result.reason, 'partial_autonomy_disabled');
  });
});

test('postTaskAutonomyApply exports shared orchestrator for background delegation', () => {
  assert.equal(typeof runAutonomyApplyOrchestrator, 'function');
  assert.equal(typeof defaultPartialAutonomyThresholds, 'function');
  const thresholds = defaultPartialAutonomyThresholds(enabledConfig);
  assert.equal(thresholds.minDashboardDepth, 1);
  assert.equal(thresholds.maxRegressionCount, 0);
});

test('applyPartialAutonomousImprovements never writes outside harness runtime/meta scope', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await applyPartialAutonomousImprovements({
      workspaceRoot,
      harnessConfig: enabledConfig,
      autonomyState: { dashboardDepth: 1, regressionCount: 0 },
      replayReports: [{ reportId: 'replay-scope', regressions: [] }],
    });

    const srcProbe = path.join(workspaceRoot, 'src', 'probe.txt');
    const packageProbe = path.join(workspaceRoot, 'package.json');

    await assert.rejects(async () => readFile(srcProbe, 'utf8'));
    await assert.rejects(async () => {
      const raw = await readFile(packageProbe, 'utf8');
      const parsed = JSON.parse(raw);
      assert.equal(parsed.partialAutonomyTouched, undefined);
    });
  });
});
