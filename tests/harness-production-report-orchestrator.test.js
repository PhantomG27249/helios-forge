import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runProductionReportCycle } from '../src/harness-sidecar/meta/productionReportOrchestrator.js';

const FIXED_NOW = new Date('2026-06-17T12:00:00.000Z');

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-production-report-'));
  try {
    await testFn({ workspaceRoot });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('runProductionReportCycle skips all reports when production gates are disabled', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await runProductionReportCycle({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          modelBackedRhoEmbeddings: { enabled: false },
          modelAssistedBesJudgment: { enabled: false },
          modelAssistedMemory: { enabled: false },
          visualReplaySuites: { enabled: false },
          ensembleCalibration: { enabled: false },
        },
      },
      task: { taskId: 'task-gates-off' },
      now: FIXED_NOW,
    });

    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.equal(result.ran.length, 0);
    assert.equal(result.skipped.length, 5);
    assert.deepEqual(
      result.skipped.map((entry) => entry.gateName).sort(),
      [
        'ensembleCalibration',
        'modelAssistedBesJudgment',
        'modelAssistedMemory',
        'modelBackedRhoEmbeddings',
        'visualReplaySuites',
      ],
    );
    await assert.rejects(
      () => access(path.join(workspaceRoot, '.harness', 'rho', 'production-grouped-rerolls')),
    );
  });
});

test('runProductionReportCycle persists grouped reroll and passk reports when gates enabled', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await runProductionReportCycle({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          modelBackedRhoEmbeddings: { enabled: true, mode: 'offline', authority: 'evidence_only' },
          ensembleCalibration: { enabled: true, mode: 'advisory', authority: 'evidence_only' },
        },
      },
      task: { taskId: 'task-gates-on' },
      now: FIXED_NOW,
    });

    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.equal(result.ran.length, 2);
    assert.equal(result.skipped.length, 3);

    const groupedEntry = result.ran.find((entry) => entry.gateName === 'modelBackedRhoEmbeddings');
    const passkEntry = result.ran.find((entry) => entry.gateName === 'ensembleCalibration');
    assert.ok(groupedEntry);
    assert.ok(passkEntry);
    assert.equal(groupedEntry.evidenceType, 'production_grouped_reroll_report');
    assert.equal(passkEntry.evidenceType, 'modelCouncilCalibration');
    assert.equal(groupedEntry.evidenceOnly, true);
    assert.equal(groupedEntry.canPromote, false);
    assert.equal(groupedEntry.promotionAllowed, false);

    const groupedRaw = await readFile(groupedEntry.filePath, 'utf8');
    const groupedReport = JSON.parse(groupedRaw);
    assert.equal(groupedReport.evidenceType, 'production_grouped_reroll_report');
    assert.equal(groupedReport.evidenceOnly, true);
    assert.equal(groupedReport.canPromote, false);
    assert.equal(groupedReport.promotionAllowed, false);
    assert.equal(groupedReport.groupedReport.canPromote, false);

    const passkRaw = await readFile(passkEntry.filePath, 'utf8');
    const passkReport = JSON.parse(passkRaw);
    assert.equal(passkReport.evidenceType, 'modelCouncilCalibration');
    assert.equal(passkReport.evidenceOnly, true);
    assert.equal(passkReport.canPromote, false);
    assert.equal(passkReport.promotionAllowed, false);
    assert.equal(passkReport.gate.enabled, true);
    assert.equal(passkReport.passKReport.canPromote, false);

    assert.equal(
      groupedEntry.filePath.startsWith(path.join(workspaceRoot, '.harness', 'rho', 'production-grouped-rerolls')),
      true,
    );
    assert.equal(
      passkEntry.filePath.startsWith(path.join(workspaceRoot, '.harness', 'model-council', 'production-passk')),
      true,
    );
  });
});
