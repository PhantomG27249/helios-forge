import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildDefaultEvolutionConfig,
  formatEvolutionYamlSection,
  resolveSwarmModelEndpoint,
  scaffoldWorkplaceEvolution,
} from '../src/harness-sidecar/meta/harnessEvolutionDefaults.js';

const DEFAULT_EVOLUTION = {
  syntheticReplay: false,
  defaultSuiteId: 'workplace-smoke',
  campaignMaxCycles: 3,
  persistFrontier: true,
  requireSwarmEndpoint: true,
};

test('buildDefaultEvolutionConfig returns workplace evolution defaults', () => {
  assert.deepEqual(buildDefaultEvolutionConfig(), DEFAULT_EVOLUTION);
});

test('formatEvolutionYamlSection emits evolution block with defaults', () => {
  const yaml = formatEvolutionYamlSection();

  assert.match(yaml, /^evolution:/m);
  assert.match(yaml, /syntheticReplay: false/);
  assert.match(yaml, /defaultSuiteId: workplace-smoke/);
  assert.match(yaml, /campaignMaxCycles: 3/);
  assert.match(yaml, /persistFrontier: true/);
  assert.match(yaml, /requireSwarmEndpoint: true/);
});

test('formatEvolutionYamlSection applies overrides without dropping other defaults', () => {
  const yaml = formatEvolutionYamlSection({ campaignMaxCycles: 5, syntheticReplay: true });

  assert.match(yaml, /campaignMaxCycles: 5/);
  assert.match(yaml, /syntheticReplay: true/);
  assert.match(yaml, /defaultSuiteId: workplace-smoke/);
});

test('resolveSwarmModelEndpoint prefers harnessConfig.models.swarmBaseUrl', () => {
  const resolved = resolveSwarmModelEndpoint(
    {
      models: { swarmBaseUrl: 'http://config.test/v1' },
      defaults: { swarmModelProfile: 'alphahelion_ebft5' },
    },
    { alphahelion_ebft5: { baseUrl: 'http://profile.test/v1' } },
  );

  assert.equal(resolved.baseUrl, 'http://config.test/v1');
  assert.equal(resolved.advisory, null);
});

test('resolveSwarmModelEndpoint falls back to model profile baseUrl', () => {
  const resolved = resolveSwarmModelEndpoint(
    { defaults: { swarmModelProfile: 'local_swarm' } },
    { local_swarm: { baseUrl: 'http://profile.test/v1', model: 'provider/model' } },
  );

  assert.equal(resolved.baseUrl, 'http://profile.test/v1');
  assert.equal(resolved.advisory, null);
});

test('resolveSwarmModelEndpoint returns advisory when endpoint is unset', () => {
  const resolved = resolveSwarmModelEndpoint(
    { defaults: { swarmModelProfile: 'alphahelion_ebft5' } },
    { alphahelion_ebft5: { baseUrl: null, model: 'selimaktas/ebft-5' } },
  );

  assert.equal(resolved.baseUrl, null);
  assert.equal(resolved.advisory?.reason, 'swarm_endpoint_unconfigured');
  assert.match(resolved.advisory?.setupHint || '', /swarmBaseUrl/i);
});

test('scaffoldWorkplaceEvolution writes suite, readme, and merges evolution config', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-evolution-scaffold-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, '.harness', 'config.yaml'),
    [
      'project:',
      '  name: Test Workplace',
      'defaults:',
      '  modelProfile: alphahelion_ebft5',
      '',
    ].join('\n'),
    'utf8',
  );

  const result = await scaffoldWorkplaceEvolution({ workspaceRoot, harnessConfig: {} });

  const suitePath = path.join(workspaceRoot, '.harness', 'benchmarks', 'suites', 'workplace-smoke.json');
  const readmePath = path.join(workspaceRoot, '.harness', 'benchmarks', 'README.md');
  const configText = await readFile(path.join(workspaceRoot, '.harness', 'config.yaml'), 'utf8');

  assert.equal(result.suitePath, suitePath);
  assert.equal(result.readmePath, readmePath);
  assert.match(configText, /evolution:/);
  assert.match(configText, /syntheticReplay: false/);
  assert.match(configText, /defaultSuiteId: workplace-smoke/);

  const suite = JSON.parse(await readFile(suitePath, 'utf8'));
  assert.equal(suite.id, 'workplace-smoke');
  assert.ok(Array.isArray(suite.cases));
  assert.ok(suite.cases.length >= 2);
  assert.ok(suite.cases.every((benchmarkCase) => benchmarkCase.command?.executable));

  const readme = await readFile(readmePath, 'utf8');
  const readmeLines = readme.split(/\r?\n/).filter((line) => line.trim().length > 0);
  assert.ok(readmeLines.length >= 8 && readmeLines.length <= 14);
  assert.match(readme, /workplace-smoke/);
});

test('scaffoldWorkplaceEvolution preserves operator evolution edits', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-evolution-preserve-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await mkdir(path.join(workspaceRoot, '.harness', 'benchmarks', 'suites'), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, '.harness', 'config.yaml'),
    [
      'project:',
      '  name: Operator Workplace',
      'evolution:',
      '  syntheticReplay: true',
      '  campaignMaxCycles: 7',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(workspaceRoot, '.harness', 'benchmarks', 'suites', 'workplace-smoke.json'),
    JSON.stringify({ id: 'workplace-smoke', operator: true }, null, 2),
    'utf8',
  );

  await scaffoldWorkplaceEvolution({
    workspaceRoot,
    harnessConfig: { evolution: { syntheticReplay: true, campaignMaxCycles: 7 } },
  });

  const configText = await readFile(path.join(workspaceRoot, '.harness', 'config.yaml'), 'utf8');
  assert.match(configText, /syntheticReplay: true/);
  assert.match(configText, /campaignMaxCycles: 7/);
  assert.match(configText, /defaultSuiteId: workplace-smoke/);

  const suite = JSON.parse(await readFile(
    path.join(workspaceRoot, '.harness', 'benchmarks', 'suites', 'workplace-smoke.json'),
    'utf8',
  ));
  assert.equal(suite.operator, true);
});
