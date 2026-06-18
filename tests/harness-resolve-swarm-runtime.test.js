import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveSwarmBaseUrl,
  resolveSwarmRuntime,
  SWARM_ENDPOINT_UNCONFIGURED_ADVISORY,
} from '../src/harness-sidecar/swarm/resolveSwarmRuntime.js';

const SETUP_HINT = 'Set models.swarmBaseUrl in .harness/config.yaml or HELIOS_SWARM_MODEL_BASE_URL';

test('resolveSwarmBaseUrl prefers harnessConfig.models.swarmBaseUrl over profile baseUrl', () => {
  const baseUrl = resolveSwarmBaseUrl({
    harnessConfig: { models: { swarmBaseUrl: 'http://config.test/v1' } },
    profile: { baseUrl: 'http://profile.test/v1' },
  });

  assert.equal(baseUrl, 'http://config.test/v1');
});

test('resolveSwarmBaseUrl falls back to profile baseUrl when harness config is unset', () => {
  const baseUrl = resolveSwarmBaseUrl({
    harnessConfig: { models: {} },
    profile: { baseUrl: 'http://profile.test/v1' },
  });

  assert.equal(baseUrl, 'http://profile.test/v1');
});

test('resolveSwarmBaseUrl returns null when neither source is configured', () => {
  const baseUrl = resolveSwarmBaseUrl({
    harnessConfig: { models: { swarmBaseUrl: null } },
    profile: { baseUrl: null },
  });

  assert.equal(baseUrl, null);
});

test('resolveSwarmRuntime returns gateway config when harness swarmBaseUrl is set', () => {
  const result = resolveSwarmRuntime({
    harnessConfig: {
      models: {
        swarmBaseUrl: 'http://config.test/v1',
        swarmModelId: 'custom-model',
      },
    },
    profile: { name: 'test_profile', baseUrl: 'http://profile.test/v1', model: 'profile-model' },
  });

  assert.ok(result.gateway);
  assert.equal(result.gateway.baseUrl, 'http://config.test/v1');
  assert.equal(result.gateway.modelId, 'custom-model');
  assert.equal(result.advisory, null);
});

test('resolveSwarmRuntime falls back to profile baseUrl when harness swarmBaseUrl is missing', () => {
  const result = resolveSwarmRuntime({
    harnessConfig: { models: {} },
    profile: { name: 'remote_llm', baseUrl: 'http://profile.test/v1', model: 'profile-model' },
    profileName: 'remote_llm',
  });

  assert.ok(result.gateway);
  assert.equal(result.gateway.baseUrl, 'http://profile.test/v1');
  assert.equal(result.gateway.modelId, 'profile-model');
  assert.equal(result.advisory, null);
});

test('resolveSwarmRuntime returns advisory instead of silently disabling when endpoint is missing', () => {
  const result = resolveSwarmRuntime({
    harnessConfig: { models: { swarmBaseUrl: null } },
    profile: { name: 'alphahelion_ebft5', baseUrl: null, model: 'selimaktas/ebft-5' },
    profileName: 'alphahelion_ebft5',
  });

  assert.equal(result.gateway, null);
  assert.deepEqual(result.advisory, {
    reason: 'swarm_endpoint_unconfigured',
    setupHint: SETUP_HINT,
  });
  assert.deepEqual(result.advisory, SWARM_ENDPOINT_UNCONFIGURED_ADVISORY);
});

test('resolveSwarmRuntime resolves profile via getModelProfile when profile object is omitted', () => {
  const result = resolveSwarmRuntime({
    harnessConfig: { models: {} },
    profileName: 'critic_with_endpoint',
    getModelProfile: (name) => {
      assert.equal(name, 'critic_with_endpoint');
      return { name, baseUrl: 'http://injected.test/v1', model: 'injected-model' };
    },
  });

  assert.ok(result.gateway);
  assert.equal(result.gateway.baseUrl, 'http://injected.test/v1');
  assert.equal(result.gateway.modelId, 'injected-model');
});
