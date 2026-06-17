import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { executeApprovedApplyAction } from '../src/harness-sidecar/core/approvalResume.js';
import { evaluateProposalTrustBoundary } from '../src/harness-sidecar/core/trustKernelGateway.js';
import {
  buildGovernanceTrustInput,
  runPostTaskRecursiveEvolutionHooks,
} from '../src/harness-sidecar/meta/recursiveEvolutionRuntimeHook.js';
import { decideGovernanceAction } from '../src/harness-sidecar/meta/governanceLoop.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

async function makeWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-recursive-evolution-'));
  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  return workspaceRoot;
}

test('trust gateway blocks path-escape apply actions', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const result = await executeApprovedApplyAction({
      approved: true,
      workspaceRoot,
      action: {
        actionId: 'act-1',
        taskId: 'task-1',
        kind: 'change_proposal_apply',
        payload: {
          proposal: {
            kind: 'source_patch',
            paths: ['../outside.js'],
            patch: 'diff',
          },
        },
      },
    });
    assert.equal(result.status, 'rejected');
    assert.match(result.reason, /trust_kernel|path_outside_workspace/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('governance evaluates trust boundary before auto-approval', () => {
  const decision = decideGovernanceAction({
    autonomyLevel: 2,
    candidate: { candidateId: 'c1', risk: 'low' },
    evidence: { baselinePassed: true, heldOutPassed: true },
    rollback: { reversible: true },
    trust: buildGovernanceTrustInput({
      workspaceRoot: process.cwd(),
      proposal: { kind: 'source_patch', paths: ['../outside.js'] },
    }),
  });
  assert.equal(decision.decision, 'escalated');
  assert.ok(decision.reasons.some((reason) => reason.startsWith('trust_kernel_blocked')));
});

test('post-task hooks persist replay evidence when operator dashboards enabled', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const result = await runPostTaskRecursiveEvolutionHooks({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          operatorDashboards: { enabled: true },
        },
        features: { localMemoryGraph: true },
      },
      task: { taskId: 'task-recursive-1' },
      rollbackDrill: { restoreVerified: true, reversible: true },
    });
    assert.equal(result.canPromote, false);
    assert.ok(result.replay?.ran?.length >= 1);
    const reportPath = path.join(
      workspaceRoot,
      '.harness',
      'benchmarks',
      'replay-cycles',
      `${result.replay.ran[0].report.reportId}.json`,
    );
    const raw = await readFile(reportPath, 'utf8');
    const report = JSON.parse(raw);
    assert.equal(report.canPromote, false);
    assert.equal(report.promotionEvidenceOnly, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('post-task hooks persist campaign evidence when source tree variants enabled', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const result = await runPostTaskRecursiveEvolutionHooks({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          operatorDashboards: { enabled: true },
          sourceTreeVariants: { enabled: true },
        },
      },
      task: { taskId: 'task-campaign-1' },
      rollbackDrill: { restoreVerified: true, reversible: true },
    });
    assert.equal(result.canPromote, false);
    assert.ok(result.campaigns?.ran?.length >= 1);
    const campaignReport = result.campaigns.ran[0].report;
    assert.equal(campaignReport.canPromote, false);
    assert.equal(campaignReport.evidenceOnly, true);
    assert.ok(campaignReport.cycles?.length >= 1 || campaignReport.campaignId);
    const reportPath = path.join(
      workspaceRoot,
      '.harness',
      'meta',
      'campaign-reports',
      `${campaignReport.reportId || campaignReport.campaignId}.json`,
    );
    const raw = await readFile(reportPath, 'utf8');
    const persisted = JSON.parse(raw);
    assert.equal(persisted.canPromote, false);
    assert.equal(persisted.promotionEvidenceOnly, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('post-task hooks persist production reports, peer cycles, and autonomy proof artifacts', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const result = await runPostTaskRecursiveEvolutionHooks({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          operatorDashboards: { enabled: true },
          modelBackedRhoEmbeddings: { enabled: true },
          ensembleCalibration: { enabled: true },
          productionA2aTransport: { enabled: true },
          productionA2aQueues: { enabled: true },
          productionAutonomyPolicy: { enabled: true },
        },
        partialAutonomy: {
          thresholds: {
            minRollbackDrillsPassed: 0,
            maxRegressionCount: 99,
            minDashboardDepth: 0,
          },
        },
      },
      task: { taskId: 'task-production-1' },
      rollbackDrill: { restoreVerified: true, reversible: true, drillId: 'drill-1' },
    });

    assert.equal(result.canPromote, false);
    assert.ok(result.productionReports?.ran?.length >= 1);
    assert.ok(result.a2aPeerCycle?.cycleId);
    const autonomySummary = JSON.parse(await readFile(
      path.join(workspaceRoot, '.harness', 'governance', 'autonomy-summary.json'),
      'utf8',
    ));
    assert.equal(autonomySummary.evidenceOnly, true);
    assert.equal(autonomySummary.canPromote, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('nested swarm cells run through orchestrateSwarm feature flag', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const result = await orchestrateSwarm({
      workspaceRoot,
      task: { taskId: 'nested-task', task: 'implement' },
      featureFlags: { nestedSwarmCells: true, localMetaHarness: true },
      commandAdapter: async () => ({
        taskOutput: { summary: 'done' },
        evolutionOutput: { hardCaseTags: ['tag-1'] },
      }),
    });
    assert.equal(result.runMode.mode, 'nested-swarm');
    assert.ok(result.attempts.length >= 2);
    assert.equal(result.nestedSwarm.canPromote, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('evaluateProposalTrustBoundary is available from production gateway module', () => {
  const boundary = evaluateProposalTrustBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'local_config',
      paths: ['src/harness-sidecar/meta/promotionPolicy.js'],
      risk: 'low',
    },
  });
  assert.equal(boundary.allowed, true);
  assert.equal(boundary.authority, 'evidence_only');
});
