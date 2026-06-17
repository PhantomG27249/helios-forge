import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadHarnessConfig } from '../src/harness-sidecar/config/configLoader.js';
import { createBackgroundEvolutionWorker } from '../src/harness-sidecar/meta/backgroundEvolutionWorker.js';
import { createHarnessSidecar } from '../src/harness-sidecar/server.js';

async function makeWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-background-evolution-'));
  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, '.harness', 'config.yaml'),
    [
      'features:',
      '  backgroundEvolution: true',
      'productionCapabilities:',
      '  backgroundEvolution:',
      '    enabled: true',
      '  operatorDashboards:',
      '    enabled: true',
      '  sourceTreeVariants:',
      '    enabled: true',
      '',
    ].join('\n'),
    'utf8',
  );
  return workspaceRoot;
}

test('background worker runTick persists replay and campaign evidence when gates enabled', async () => {
  const workspaceRoot = await makeWorkspace();
  const events = [];
  const worker = createBackgroundEvolutionWorker({
    workspaceRoot,
    intervalMs: 86_400_000,
    loadHarnessConfig: () => loadHarnessConfig({ workspaceRoot }),
    emitEvent: async (event) => {
      events.push(event);
    },
  });

  try {
    worker.start();
    const tick = await worker.runTick();

    assert.notEqual(tick.skipped, true);
    assert.ok(tick.replay?.ran?.length >= 1);
    assert.ok(tick.campaigns?.ran?.length >= 1);
    assert.equal(tick.canPromote, false);

    const replayDir = path.join(workspaceRoot, '.harness', 'benchmarks', 'replay-cycles');
    const replayFiles = (await readdir(replayDir)).filter((name) => name.endsWith('.json'));
    assert.ok(replayFiles.length >= 1);

    const campaignDir = path.join(workspaceRoot, '.harness', 'meta', 'campaign-reports');
    const campaignFiles = (await readdir(campaignDir)).filter((name) => name.endsWith('.json'));
    assert.ok(campaignFiles.length >= 1);

    const autonomyPath = path.join(workspaceRoot, '.harness', 'meta', 'autonomy-evidence.json');
    const autonomyRaw = await readFile(autonomyPath, 'utf8');
    const autonomy = JSON.parse(autonomyRaw);
    assert.ok(autonomy);

    const status = worker.getStatus();
    assert.ok(status.lastTickAt);
    assert.equal(status.lastResult?.canPromote, false);
    assert.ok(events.some((event) => event.type === 'replay.cycle_completed'));
    assert.ok(events.some((event) => event.type === 'meta.campaign_cycle_completed'));
  } finally {
    worker.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('sidecar starts background evolution worker and exposes status endpoint', async () => {
  const workspaceRoot = await makeWorkspace();
  const sidecar = createHarnessSidecar({ workspaceRoot, port: 0 });

  try {
    await sidecar.start();

    const worker = createBackgroundEvolutionWorker({
      workspaceRoot,
      intervalMs: 86_400_000,
      loadHarnessConfig: () => loadHarnessConfig({ workspaceRoot }),
    });
    await worker.runTick();
    worker.stop();

    const response = await fetch(`${sidecar.url}/v1/evidence/background-evolution`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.type, 'backgroundEvolution');
    assert.equal(body.evidenceOnly, true);
    assert.equal(body.canPromote, false);
    assert.equal(body.gate.enabled, true);
    assert.equal(body.worker.running, true);
    assert.ok(body.summary.itemCount >= 1);
    assert.ok(body.items.length >= 1);

    const replayDir = path.join(workspaceRoot, '.harness', 'benchmarks', 'replay-cycles');
    const replayReport = JSON.parse(
      await readFile(path.join(replayDir, (await readdir(replayDir))[0]), 'utf8'),
    );
    assert.equal(replayReport.canPromote, false);
    assert.equal(replayReport.promotionEvidenceOnly, true);
  } finally {
    await sidecar.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('sidecar stops background evolution worker cleanly', async () => {
  const workspaceRoot = await makeWorkspace();
  const sidecar = createHarnessSidecar({ workspaceRoot, port: 0 });

  try {
    await sidecar.start();
    await sidecar.stop();

    const sidecarAgain = createHarnessSidecar({ workspaceRoot, port: 0 });
    await sidecarAgain.start();
    const response = await fetch(`${sidecarAgain.url}/v1/evidence/background-evolution`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.worker.running, true);
    await sidecarAgain.stop();
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
