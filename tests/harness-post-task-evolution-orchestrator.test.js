import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runPostTaskEvolutionOrchestrator } from '../src/harness-sidecar/meta/postTaskEvolutionOrchestrator.js';

const FIXED_NOW = new Date('2026-06-18T12:00:00.000Z');
const FIXED_ISO = FIXED_NOW.toISOString();

function gatesConfig(overrides = {}) {
  return {
    evolution: { syntheticReplay: false, defaultSuiteId: 'workplace-smoke', persistFrontier: true },
    productionCapabilities: {
      operatorDashboards: { enabled: false },
      sourceTreeVariants: { enabled: false },
      ...overrides,
    },
  };
}

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-post-task-orchestrator-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeHeldOutSuite(workspaceRoot, suite) {
  const suitesDir = path.join(workspaceRoot, '.harness', 'benchmarks', 'suites');
  await mkdir(suitesDir, { recursive: true });
  await writeFile(
    path.join(suitesDir, `${suite.id}.json`),
    `${JSON.stringify(suite, null, 2)}\n`,
    'utf8',
  );
}

function recordingEmitEvent() {
  const events = [];
  const emitEvent = async (event) => {
    events.push(event);
  };
  return { events, emitEvent };
}

function stubCampaignCommandRunner() {
  return async ({ cwd, command, args }) => {
    await mkdir(path.join(cwd, '.harness', 'replay'), { recursive: true });
    await writeFile(
      path.join(cwd, '.harness', 'replay', 'report.json'),
      JSON.stringify({
        replayId: 'orchestrator_variant_replay',
        command,
        args,
        cases: [{ caseId: 'heldout', passed: true }],
      }),
      'utf8',
    );
    return { exitCode: 0, stdout: 'ok', stderr: '' };
  };
}

test('always emits recursive_evolution.coordinated in finally', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const { events, emitEvent } = recordingEmitEvent();

    const result = await runPostTaskEvolutionOrchestrator({
      workspaceRoot,
      harnessConfig: gatesConfig(),
      task: { taskId: 'task-coordinated' },
      emitEvent,
      deps: { now: () => FIXED_NOW },
    });

    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    const coordinatedEvents = events.filter((event) => event.type === 'recursive_evolution.coordinated');
    assert.equal(coordinatedEvents.length, 1);
    assert.equal(coordinatedEvents[0].taskId, 'task-coordinated');
    assert.equal(coordinatedEvents[0].evidenceOnly, true);
    assert.equal(coordinatedEvents[0].canPromote, false);
    assert.equal(events.at(-1).type, 'recursive_evolution.coordinated');
  });
});

test('emits recursive_evolution.coordinated in finally when replay deps throw', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const { events, emitEvent } = recordingEmitEvent();

    await assert.rejects(
      () => runPostTaskEvolutionOrchestrator({
        workspaceRoot,
        harnessConfig: gatesConfig({
          operatorDashboards: { enabled: true },
        }),
        task: { taskId: 'task-finally-error' },
        emitEvent,
        deps: {
          now: () => FIXED_NOW,
          runDueReplaySchedules: async () => {
            throw new Error('replay scheduler failed');
          },
          createHeldOutSuiteStore: () => ({
            loadSuite: async () => ({
              id: 'workplace-smoke',
              domains: ['code'],
              cases: [{ id: 'c1', domain: 'code', command: 'node -e "process.exit(0)"' }],
            }),
          }),
        },
      }),
      /replay scheduler failed/,
    );

    const coordinatedEvents = events.filter((event) => event.type === 'recursive_evolution.coordinated');
    assert.equal(coordinatedEvents.length, 1);
    assert.equal(coordinatedEvents[0].taskId, 'task-finally-error');
  });
});

test('operatorDashboards with missing suite skips replay without stub scores', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const { events, emitEvent } = recordingEmitEvent();

    const result = await runPostTaskEvolutionOrchestrator({
      workspaceRoot,
      harnessConfig: gatesConfig({
        operatorDashboards: { enabled: true },
      }),
      task: { taskId: 'task-no-suite' },
      emitEvent,
      deps: { now: () => FIXED_NOW },
    });

    assert.equal(result.replay.ran.length, 0);
    assert.equal(result.replay.skipped.length, 1);
    assert.equal(result.replay.skipped[0].reason, 'held_out_suite_missing');

    const skippedEvent = events.find((event) => event.type === 'replay.skipped');
    assert.ok(skippedEvent);
    assert.equal(skippedEvent.reason, 'held_out_suite_missing');
    assert.equal(skippedEvent.evidenceOnly, true);
    assert.equal(skippedEvent.canPromote, false);

    const replayDir = path.join(workspaceRoot, '.harness', 'benchmarks', 'replay-cycles');
    await assert.rejects(() => readFile(replayDir, 'utf8'), { code: 'ENOENT' });
  });
});

test('operatorDashboards with empty suite cases skips replay without stub scores', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeHeldOutSuite(workspaceRoot, {
      id: 'workplace-smoke',
      domains: ['code'],
      cases: [],
    });

    const { events, emitEvent } = recordingEmitEvent();
    const result = await runPostTaskEvolutionOrchestrator({
      workspaceRoot,
      harnessConfig: gatesConfig({
        operatorDashboards: { enabled: true },
      }),
      task: { taskId: 'task-empty-suite' },
      emitEvent,
      deps: { now: () => FIXED_NOW },
    });

    assert.equal(result.replay.ran.length, 0);
    assert.equal(result.replay.skipped[0].reason, 'held_out_suite_missing');
    assert.ok(events.some((event) => event.type === 'replay.skipped' && event.reason === 'held_out_suite_missing'));
  });
});

test('sourceTreeVariants persists campaign report with unique campaign-taskId-iso filename', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(path.join(workspaceRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'runner.js'), 'export const baseline = true;\n', 'utf8');

    const taskId = 'task-campaign-iso';
    const expectedReportId = `campaign-${taskId}-${FIXED_ISO}`.replace(/[^A-Za-z0-9_-]+/g, '-');

    const result = await runPostTaskEvolutionOrchestrator({
      workspaceRoot,
      harnessConfig: gatesConfig({
        sourceTreeVariants: { enabled: true },
      }),
      task: { taskId },
      deps: {
        now: () => FIXED_NOW,
        commandRunner: stubCampaignCommandRunner(),
      },
    });

    assert.ok(result.campaigns?.ran?.length >= 1);
    const reportPath = path.join(
      workspaceRoot,
      '.harness',
      'meta',
      'campaign-reports',
      `${expectedReportId}.json`,
    );
    const raw = await readFile(reportPath, 'utf8');
    const persisted = JSON.parse(raw);
    assert.equal(persisted.canPromote, false);
    assert.equal(persisted.evidenceOnly, true);
    assert.ok(persisted.cycles?.length >= 1);
  });
});

function stubReplayRunners() {
  return {
    baselineRunner: async () => ({ metrics: { quality: 0.8 }, passed: true }),
    candidateRunner: async () => ({ metrics: { quality: 0.85 }, passed: true }),
  };
}

test('calls injected appendFrontierDashboardEntry after replay and campaign', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(path.join(workspaceRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'runner.js'), 'export const baseline = true;\n', 'utf8');
    await writeHeldOutSuite(workspaceRoot, {
      id: 'workplace-smoke',
      domains: ['code'],
      cases: [{
        id: 'pass-case',
        domain: 'code',
      }],
    });

    let frontierCall = null;
    const result = await runPostTaskEvolutionOrchestrator({
      workspaceRoot,
      harnessConfig: gatesConfig({
        operatorDashboards: { enabled: true },
        sourceTreeVariants: { enabled: true },
      }),
      task: { taskId: 'task-frontier' },
      deps: {
        now: () => FIXED_NOW,
        commandRunner: stubCampaignCommandRunner(),
        createTaskReplayRunners: () => stubReplayRunners(),
        appendFrontierDashboardEntry: async (args) => {
          frontierCall = args;
          return { evidenceOnly: true, canPromote: false, ...args };
        },
      },
    });

    assert.ok(result.replay?.ran?.length >= 1);
    assert.ok(result.campaigns?.ran?.length >= 1);
    assert.ok(frontierCall);
    assert.equal(frontierCall.workspaceRoot, workspaceRoot);
    assert.equal(frontierCall.replayReport.reportId, result.replay.ran[0].report.reportId);
    assert.equal(
      frontierCall.campaignReport.reportId || frontierCall.campaignReport.campaignId,
      result.campaigns.ran[0].report.reportId || result.campaigns.ran[0].report.campaignId,
    );
  });
});

test('calls writeBackgroundTickRecord when task source is background', async () => {
  await withWorkspace(async (workspaceRoot) => {
    let tickCall = null;
    const tickId = 'background-20260618T120000000Z';

    const result = await runPostTaskEvolutionOrchestrator({
      workspaceRoot,
      harnessConfig: gatesConfig(),
      task: {
        taskId: 'background-evolution',
        source: 'background',
        tickId,
      },
      deps: {
        now: () => FIXED_NOW,
        writeBackgroundTickRecord: async (args) => {
          tickCall = args;
          return { tickId, evidenceOnly: true, canPromote: false };
        },
      },
    });

    assert.ok(tickCall);
    assert.equal(tickCall.workspaceRoot, workspaceRoot);
    assert.equal(tickCall.tickId, tickId);
    assert.deepEqual(tickCall.hookResults, result);
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
  });
});
