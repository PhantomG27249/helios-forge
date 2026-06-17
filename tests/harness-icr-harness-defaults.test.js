import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ICR_DEFAULT_CONFIG } from '../src/harness-sidecar/icr/icrContracts.js';
import {
  buildDefaultHarnessIcrConfig,
  buildDefaultHarnessIcrLaneGate,
  formatHarnessIcrYamlSection,
} from '../src/harness-sidecar/icr/icrHarnessDefaults.js';

test('buildDefaultHarnessIcrConfig merges harness flags with ICR tuning defaults', () => {
  const config = buildDefaultHarnessIcrConfig();

  assert.equal(config.enabled, false);
  assert.equal(config.mode, 'evidence_only');
  assert.equal(config.persistOnTask, true);
  assert.equal(config.includeRhoComparison, true);
  assert.equal(config.useModelRunners, false);
  assert.equal(config.branchBreadth, ICR_DEFAULT_CONFIG.branchBreadth);
  assert.equal(config.correctionDepth, ICR_DEFAULT_CONFIG.correctionDepth);
  assert.equal(config.hypothesisCount, ICR_DEFAULT_CONFIG.hypothesisCount);
  assert.equal(config.maxContextTokens, ICR_DEFAULT_CONFIG.maxContextTokens);
});

test('buildDefaultHarnessIcrConfig can opt in to enabled ICR lane', () => {
  const config = buildDefaultHarnessIcrConfig({ enabled: true, useModelRunners: true });
  assert.equal(config.enabled, true);
  assert.equal(config.useModelRunners, true);
});

test('formatHarnessIcrYamlSection emits enabled ICR and production gate', () => {
  const yaml = formatHarnessIcrYamlSection({ enabled: true, includeProductionGate: true });

  assert.match(yaml, /^icr:/m);
  assert.match(yaml, /enabled: true/);
  assert.match(yaml, /branchBreadth: 5/);
  assert.match(yaml, /correctionDepth: 10/);
  assert.match(yaml, /includeRhoComparison: true/);
  assert.match(yaml, /productionCapabilities:/);
  assert.match(yaml, /icrLane:/);
  assert.match(yaml, /mode: advisory/);
});

test('buildDefaultHarnessIcrLaneGate stays evidence-only', () => {
  assert.deepEqual(buildDefaultHarnessIcrLaneGate({ enabled: true, mode: 'advisory' }), {
    enabled: true,
    mode: 'advisory',
    authority: 'evidence_only',
  });
});
