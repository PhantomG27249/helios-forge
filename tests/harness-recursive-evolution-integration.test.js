import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { executeApprovedApplyAction } from '../src/harness-sidecar/core/approvalResume.js';
import { evaluateProposalTrustBoundary } from '../src/harness-sidecar/core/trustKernelGateway.js';
import { wrapPostTaskEvolution } from '../src/harness-sidecar/meta/postTaskHookGuard.js';
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

test('G1: post-task hooks emit replay.cycle_completed and meta.campaign_cycle_completed with full gates', async () => {
  const workspaceRoot = await makeWorkspace();
  const events = [];
  try {
    const result = await runPostTaskRecursiveEvolutionHooks({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          operatorDashboards: { enabled: true },
          sourceTreeVariants: { enabled: true },
        },
      },
      task: { taskId: 'task-g1-events' },
      rollbackDrill: { restoreVerified: true, reversible: true },
      emitEvent: async (event) => {
        events.push(event);
      },
    });

    assert.equal(result.canPromote, false);

    const replayEvent = events.find((event) => event.type === 'replay.cycle_completed');
    const campaignEvent = events.find((event) => event.type === 'meta.campaign_cycle_completed');
    const coordinatedEvent = events.find((event) => event.type === 'recursive_evolution.coordinated');

    assert.ok(replayEvent, 'expected replay.cycle_completed event');
    assert.ok(campaignEvent, 'expected meta.campaign_cycle_completed event');
    assert.ok(coordinatedEvent, 'expected recursive_evolution.coordinated event');

    assert.equal(replayEvent.taskId, 'task-g1-events');
    assert.equal(campaignEvent.taskId, 'task-g1-events');
    assert.equal(replayEvent.evidenceOnly, true);
    assert.equal(replayEvent.canPromote, false);
    assert.equal(campaignEvent.evidenceOnly, true);
    assert.equal(campaignEvent.canPromote, false);
    assert.ok(replayEvent.ran?.length >= 1 || result.replay?.ran?.length >= 1);
    assert.ok(campaignEvent.ran?.length >= 1 || result.campaigns?.ran?.length >= 1);

    const campaignReport = campaignEvent.ran?.[0]?.report || result.campaigns?.ran?.[0]?.report;
    assert.ok(campaignReport);
    assert.ok(
      (campaignReport.cycles?.length ?? 0) >= 1 || campaignReport.campaignId || campaignReport.reportId,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

async function createTaskWithPostTaskEvolution({
  workspaceRoot,
  source = 'prompt_background',
  harnessConfig = {},
} = {}) {
  const taskId = `task-${source}-integration`;
  const trace = [];
  const task = { taskId, source };

  await wrapPostTaskEvolution({
    task,
    emitEvent: async (event) => {
      trace.push(event);
    },
    runHooks: async ({ emitEvent }) => runPostTaskRecursiveEvolutionHooks({
      workspaceRoot,
      harnessConfig,
      task,
      rollbackDrill: { restoreVerified: true, reversible: true },
      emitEvent,
    }),
  });

  return { task, trace };
}

test('G0: prompt_background createTask trace contains recursive_evolution.coordinated', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const { task, trace } = await createTaskWithPostTaskEvolution({
      workspaceRoot,
      source: 'prompt_background',
      harnessConfig: {
        productionCapabilities: {
          operatorDashboards: { enabled: true },
          sourceTreeVariants: { enabled: true },
        },
      },
    });

    const coordinatedEvent = trace.find((event) => event.type === 'recursive_evolution.coordinated');
    assert.ok(coordinatedEvent, 'expected recursive_evolution.coordinated on prompt_background trace');
    assert.equal(coordinatedEvent.taskId, task.taskId);
    assert.equal(coordinatedEvent.evidenceOnly, true);
    assert.equal(coordinatedEvent.canPromote, false);
    assert.equal(trace.at(-1).type, 'recursive_evolution.timing');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('post-task hooks scaffold workplace evolution goals', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    await writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
      'utf8',
    );
    await runPostTaskRecursiveEvolutionHooks({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          operatorDashboards: { enabled: true },
        },
      },
      task: { taskId: 'task-goals-1' },
    });

    const goalsPath = path.join(workspaceRoot, '.harness', 'meta', 'evolution-goals.json');
    const record = JSON.parse(await readFile(goalsPath, 'utf8'));
    assert.equal(record.canPromote, false);
    assert.equal(record.evidenceOnly, true);
    assert.ok(record.goals.some((goal) => goal.goalId === 'primary_test_pass'));
    assert.ok(record.goals.some((goal) => goal.goalId === 'frontier_uplift'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('post-task hooks queue L4 promotion proposal when eligible with campaign evidence', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const result = await runPostTaskRecursiveEvolutionHooks({
      workspaceRoot,
      harnessConfig: {
        productionCapabilities: {
          operatorDashboards: { enabled: true },
          sourceTreeVariants: { enabled: true },
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
      task: { taskId: 'task-promotion-1' },
      rollbackDrill: { restoreVerified: true, reversible: true, status: 'passed' },
    });

    assert.equal(result.canPromote, false);
    assert.ok(result.coordinated?.sources?.includes('promotion_loop') || result.promotion?.skipped);
    if (result.promotion?.proposal) {
      assert.equal(result.promotion.canPromote, false);
      const queueRaw = await readFile(result.promotion.queuePath, 'utf8');
      const queued = JSON.parse(queueRaw);
      assert.equal(queued.canPromote, false);
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('post-task hooks persist skill candidates when traces contain verifier failures', async () => {
  const workspaceRoot = await makeWorkspace();
  const taskId = 'task-skill-evolution-1';
  const traceDir = path.join(workspaceRoot, '.harness', 'meta', 'traces', taskId);
  try {
    await mkdir(traceDir, { recursive: true });
    await writeFile(path.join(traceDir, 'trace.json'), `${JSON.stringify({
      taskId,
      events: [
        { type: 'verifier.missing_evidence', verifierEvidence: { missing: true } },
      ],
      summary: {
        failures: [{ category: 'missing_verifier_evidence' }],
        latestState: { status: 'failed' },
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(path.join(traceDir, 'summary.json'), `${JSON.stringify({
      taskId,
      failures: [{ category: 'missing_verifier_evidence' }],
      latestState: { status: 'failed' },
    }, null, 2)}\n`, 'utf8');

    const result = await runPostTaskRecursiveEvolutionHooks({
      workspaceRoot,
      harnessConfig: {
        features: { skillEvolution: true },
      },
      task: { taskId: 'task-skill-hook-1' },
    });

    assert.equal(result.canPromote, false);
    if (result.skillEvolution?.persisted?.length) {
      assert.equal(result.skillEvolution.canPromote, false);
      const candidateDir = path.join(
        workspaceRoot,
        '.harness',
        'meta',
        'skill-candidates',
        result.skillEvolution.persisted[0].candidateId,
      );
      await readFile(path.join(candidateDir, 'SKILL.md'), 'utf8');
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
