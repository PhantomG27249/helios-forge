import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildDefaultEvolutionConfig,
  scaffoldWorkplaceEvolution,
} from '../src/harness-sidecar/meta/harnessEvolutionDefaults.js';
import { runPostTaskEvolutionOrchestrator } from '../src/harness-sidecar/meta/postTaskEvolutionOrchestrator.js';
import { setupHeliosForge } from '../scripts/setup-helios-forge.js';

const FIXED_NOW = new Date('2026-06-18T12:00:00.000Z');

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function fullGatesHarnessConfig(overrides = {}) {
  return {
    evolution: buildDefaultEvolutionConfig(),
    productionCapabilities: {
      operatorDashboards: { enabled: true },
      sourceTreeVariants: { enabled: true },
    },
    ...overrides,
    evolution: {
      ...buildDefaultEvolutionConfig(),
      ...(overrides.evolution || {}),
    },
    productionCapabilities: {
      operatorDashboards: { enabled: true },
      sourceTreeVariants: { enabled: true },
      ...(overrides.productionCapabilities || {}),
    },
  };
}

async function writeReplayReadySuite(workspaceRoot, {
  suiteId = 'workplace-smoke',
  cases = [{
    id: 'workplace-exit-sanity',
    domain: 'code',
    command: 'node -e "process.exit(0)"',
    metricWeights: { quality: 1 },
  }],
} = {}) {
  const suitesDir = path.join(workspaceRoot, '.harness', 'benchmarks', 'suites');
  await mkdir(suitesDir, { recursive: true });
  await writeFile(
    path.join(suitesDir, `${suiteId}.json`),
    `${JSON.stringify({
      id: suiteId,
      domains: [...new Set(cases.map((benchmarkCase) => benchmarkCase.domain))],
      cases,
    }, null, 2)}\n`,
    'utf8',
  );
}

async function seedCampaignVariantFiles(workspaceRoot) {
  await writeFile(path.join(workspaceRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
  await writeFile(
    path.join(workspaceRoot, 'runner.js'),
    'export const baseline = true;\n',
    'utf8',
  );
}

function stubCampaignCommandRunner() {
  return async ({ cwd, command, args }) => {
    await mkdir(path.join(cwd, '.harness', 'replay'), { recursive: true });
    await writeFile(
      path.join(cwd, '.harness', 'replay', 'report.json'),
      JSON.stringify({
        replayId: 'integration_variant_replay',
        command,
        args,
        cases: [{ caseId: 'heldout', passed: true }],
      }),
      'utf8',
    );
    return { exitCode: 0, stdout: 'ok', stderr: '' };
  };
}

test('setupHeliosForge scaffolds workplace-smoke held-out suite (G0 integration)', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-meta-evolution-setup-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await setupHeliosForge({ workspaceRoot });

  const suitePath = path.join(
    workspaceRoot,
    '.harness',
    'benchmarks',
    'suites',
    'workplace-smoke.json',
  );
  assert.ok(
    await exists(suitePath),
    'setupHeliosForge must scaffold .harness/benchmarks/suites/workplace-smoke.json',
  );
});

test('workplace meta-evolution orchestrator persists replay and campaign evidence', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-meta-evolution-cycle-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await scaffoldWorkplaceEvolution({ workspaceRoot });
  await seedCampaignVariantFiles(workspaceRoot);

  const suitePath = path.join(
    workspaceRoot,
    '.harness',
    'benchmarks',
    'suites',
    'workplace-smoke.json',
  );
  assert.ok(await exists(suitePath));
  const scaffoldedSuite = JSON.parse(await readFile(suitePath, 'utf8'));

  const harnessConfig = fullGatesHarnessConfig();
  const events = [];

  const result = await runPostTaskEvolutionOrchestrator({
    workspaceRoot,
    harnessConfig,
    task: { taskId: 'task_meta_integration_1' },
    emitEvent: async (event) => {
      events.push(event);
    },
    deps: {
      now: () => FIXED_NOW,
      commandRunner: stubCampaignCommandRunner(),
      createHeldOutSuiteStore: () => ({
        loadSuite: async (suiteId) => {
          if (suiteId === scaffoldedSuite.id) return scaffoldedSuite;
          throw Object.assign(new Error(`held-out suite not found: ${suiteId}`), { code: 'ENOENT' });
        },
      }),
    },
  });

  assert.equal(result.canPromote, false);
  assert.ok(result.replay?.ran?.length >= 1);
  assert.ok(result.campaigns?.ran?.length >= 1);

  const replayDir = path.join(workspaceRoot, '.harness', 'benchmarks', 'replay-cycles');
  const replayFiles = (await readdir(replayDir)).filter((name) => name.endsWith('.json'));
  assert.ok(replayFiles.length >= 1);

  const campaignDir = path.join(workspaceRoot, '.harness', 'meta', 'campaign-reports');
  const campaignFiles = (await readdir(campaignDir)).filter((name) => name.endsWith('.json'));
  assert.ok(campaignFiles.length >= 1);

  const replayReport = JSON.parse(await readFile(path.join(replayDir, replayFiles[0]), 'utf8'));
  if (harnessConfig.evolution.syntheticReplay !== true) {
    assert.notEqual(
      replayReport.aggregateScore,
      0.05,
      'stub replay baseline 0.5 / candidate 0.55 must not run when syntheticReplay is false',
    );
  }

  const campaignEvent = events.find((event) => event.type === 'meta.campaign_cycle_completed');
  assert.ok(campaignEvent, 'expected meta.campaign_cycle_completed event');
  const campaignReport = campaignEvent.ran?.[0]?.report;
  assert.ok(campaignReport);
  assert.ok(
    (campaignReport.cycles?.length ?? 0) >= 1 || (campaignReport.report?.cycles?.length ?? 0) >= 1,
    'campaign report must include at least one cycle',
  );

  const variantRoot = path.join(workspaceRoot, '.harness', 'meta', 'harness-variants');
  assert.ok(await exists(variantRoot), 'expected harness variant workspace root');
  const variantDirs = await readdir(variantRoot);
  assert.ok(variantDirs.length >= 1, 'expected variant dir under .harness/meta/harness-variants/');
});

test('syntheticReplay opt-in may emit stub aggregateScore 0.05', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-meta-evolution-synthetic-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await scaffoldWorkplaceEvolution({ workspaceRoot });
  await seedCampaignVariantFiles(workspaceRoot);
  await writeReplayReadySuite(workspaceRoot);

  const harnessConfig = fullGatesHarnessConfig({
    evolution: { syntheticReplay: true },
  });

  const result = await runPostTaskEvolutionOrchestrator({
    workspaceRoot,
    harnessConfig,
    task: { taskId: 'task_meta_synthetic' },
    deps: {
      now: () => FIXED_NOW,
      commandRunner: stubCampaignCommandRunner(),
    },
  });

  const replayReport = result.replay?.ran?.[0]?.report;
  assert.ok(replayReport);
  assert.equal(replayReport.aggregateScore, 0.05);
});
