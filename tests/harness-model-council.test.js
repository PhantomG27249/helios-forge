import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  endpointProfileToOverride,
  normalizeEndpointProfiles,
  resolveEndpointProfile,
} from '../src/harness-sidecar/model/modelEndpointProfiles.js';
import { createRoutingModelProvider } from '../src/harness-sidecar/model/routingModelProvider.js';
import {
  buildModelCouncilRuntime,
  resolveAttemptModelRoute,
  summarizeModelCouncil,
} from '../src/harness-sidecar/swarm/modelCouncil.js';

test('normalizes council endpoint profiles safely', () => {
  const longModelId = `${'model-'.repeat(80)}tail`;
  const profiles = normalizeEndpointProfiles({
    fast: {
      baseUrl: '  http://model.test/v1  ',
      modelId: longModelId,
      supportsVision: true,
      healthEnabled: true,
      apiKeyEnv: '  HELIOS_FAST_API_KEY  ',
      apiKey: 'raw-secret-value',
    },
    unusable: {
      baseUrl: 'http://missing-model.test/v1',
    },
    markerOnly: {
      baseUrl: 'http://marker.test/v1',
      modelId: 'marker-model',
      apiKeyConfigured: true,
    },
    scalar: 'ignore-me',
  });

  assert.equal(profiles.fast.baseUrl, 'http://model.test/v1');
  assert.equal(profiles.fast.modelId.length, 256);
  assert.equal(profiles.fast.modelId, longModelId.slice(0, 256));
  assert.equal(profiles.fast.supportsVision, true);
  assert.equal(profiles.fast.healthEnabled, true);
  assert.equal(profiles.fast.apiKeyEnv, 'HELIOS_FAST_API_KEY');
  assert.equal(profiles.fast.apiKeyConfigured, true);
  assert.equal('apiKey' in profiles.fast, false);
  assert.equal('apiKeyConfigured' in profiles.markerOnly, false);
  assert.equal('scalar' in profiles, false);
  assert.equal('unusable' in profiles, false);
});

test('resolves endpoint profiles with safe fallback handling', () => {
  const endpointProfiles = normalizeEndpointProfiles({
    fast: {
      baseUrl: 'http://model.test/v1',
      modelId: 'fast-model',
    },
  });

  assert.equal(resolveEndpointProfile({ endpointProfiles, endpointProfileId: 'missing' }), null);
  assert.equal(
    resolveEndpointProfile({
      endpointProfiles,
      endpointProfileId: 'missing',
      fallback: { baseUrl: 'http://fallback.test/v1' },
    }),
    null,
  );
  assert.deepEqual(
    resolveEndpointProfile({
      endpointProfiles,
      endpointProfileId: 'missing',
      fallback: {
        baseUrl: 'http://fallback.test/v1',
        modelId: 'fallback-model',
        supportsVision: true,
      },
    }),
    {
      baseUrl: 'http://fallback.test/v1',
      modelId: 'fallback-model',
      supportsVision: true,
    },
  );
  assert.equal(resolveEndpointProfile({ endpointProfiles, endpointProfileId: 'fast' }).modelId, 'fast-model');
});

test('endpoint profile overrides are suitable for model gateway without exposing secrets', () => {
  const endpoint = resolveEndpointProfile({
    endpointProfiles: normalizeEndpointProfiles({
      critic: {
        baseUrl: 'http://critic.test/v1',
        modelId: 'critic-model',
        supportsVision: false,
        healthEnabled: true,
        apiKeyEnv: 'CRITIC_API_KEY',
        apiKey: 'never-return-this',
      },
    }),
    endpointProfileId: 'critic',
  });

  assert.deepEqual(endpointProfileToOverride(endpoint), {
    model: 'critic-model',
    baseUrl: 'http://critic.test/v1',
    supportsVision: false,
    modelCouncilEndpointProfile: 'critic',
    apiKeyEnv: 'CRITIC_API_KEY',
    apiKeyConfigured: true,
    healthEnabled: true,
  });
});

test('builds evidence-only role routes when multi-model council is enabled', () => {
  const council = buildModelCouncilRuntime({
    harnessConfig: {
      features: { multiModelSwarm: true },
      modelCouncil: {
        enabled: true,
        roles: {
          implementer: { modelProfile: 'alphahelion_ebft5', endpointProfile: 'fast' },
          reviewer: { modelProfile: 'critic_low_temp', endpointProfile: 'critic' },
          'visual-specialist': { modelProfile: 'qwen36_vlm_fast', endpointProfile: 'fast' },
          researcher: { modelProfile: 'qwen36_vlm_deep' },
        },
        endpointProfiles: {
          fast: { baseUrl: 'http://model.test/v1', modelId: 'fast-model', supportsVision: true },
          critic: { baseUrl: 'http://critic.test/v1', modelId: 'critic-model' },
        },
      },
    },
    fallbackModel: { profileName: 'fallback_profile', baseUrl: 'http://fallback.test/v1', modelId: 'fallback-model' },
  });

  assert.equal(council.enabled, true);
  assert.equal(council.authority, 'evidence_only');
  assert.equal(council.canPromote, false);
  assert.deepEqual(council.roleRoutes.implementer, {
    role: 'implementer',
    modelProfile: 'alphahelion_ebft5',
    endpointProfile: 'fast',
    endpoint: { baseUrl: 'http://model.test/v1', modelId: 'fast-model', supportsVision: true },
    authority: 'evidence_only',
    canPromote: false,
  });
  assert.equal(council.roleRoutes.reviewer.endpoint.modelId, 'critic-model');
  assert.equal(council.roleRoutes.researcher.modelProfile, 'qwen36_vlm_deep');
});

test('resolves attempt model routes with role fallback and disabled council safety', () => {
  const disabled = buildModelCouncilRuntime({
    harnessConfig: {
      features: { multiModelSwarm: false },
      modelCouncil: { enabled: true },
    },
  });
  assert.deepEqual(disabled, {
    enabled: false,
    roleRoutes: {},
    endpointProfiles: {},
    profileOverrides: {},
    bridgeHints: null,
    authority: 'disabled',
    canPromote: false,
  });

  const council = buildModelCouncilRuntime({
    harnessConfig: {
      features: { multiModelSwarm: true },
      modelCouncil: {
        enabled: true,
        roles: {
          implementer: { modelProfile: 'implementer_model', endpointProfile: 'fast' },
        },
        endpointProfiles: {
          fast: { baseUrl: 'http://fast.test/v1', modelId: 'fast-model' },
        },
      },
    },
    fallbackModel: { profileName: 'fallback_model', baseUrl: 'http://fallback.test/v1', modelId: 'fallback-model' },
  });

  assert.equal(resolveAttemptModelRoute({
    council,
    attempt: { profile: { id: 'missing', role: 'missing-role', modelProfile: 'attempt_model' } },
    role: 'missing-role',
  }).modelProfile, 'attempt_model');
  assert.equal(resolveAttemptModelRoute({ council, attempt: {}, role: 'implementer' }).modelProfile, 'implementer_model');
  assert.equal(resolveAttemptModelRoute({ council, attempt: {}, role: 'unknown' }).modelProfile, 'implementer_model');
});

test('summarizes model council diversity and disagreement as evidence only', () => {
  const council = buildModelCouncilRuntime({
    harnessConfig: {
      features: { multiModelSwarm: true },
      modelCouncil: { enabled: true, diversityRequired: 2 },
    },
  });
  const attempts = [
    { attemptId: 'a1', role: 'implementer', model: { route: { modelProfile: 'fast', endpointProfile: 'local' } }, output: { summary: 'Fix A' }, score: 80, verifierPassed: true },
    { attemptId: 'a2', role: 'reviewer', model: { route: { modelProfile: 'critic', endpointProfile: 'local' } }, output: { summary: 'Risk in A' }, score: 65, verifierPassed: true },
    { attemptId: 'a3', role: 'risk-auditor', model: { route: { modelProfile: 'critic', endpointProfile: 'critic' } }, output: { summary: 'No secret risk' }, score: 70, verifierPassed: false },
  ];
  const report = summarizeModelCouncil({ council, attempts, champion: attempts[0] });

  assert.equal(report.authority, 'evidence_only');
  assert.equal(report.canPromote, false);
  assert.equal(report.modelDiversity.uniqueModelProfiles, 2);
  assert.equal(report.modelDiversity.uniqueEndpointProfiles, 2);
  assert.equal(report.coverage.roles.includes('implementer'), true);
  assert.equal(report.coverage.roles.includes('reviewer'), true);
  assert.equal(report.disagreement.status, 'present');
  assert.deepEqual(report.agreement.supportingAttemptIds, ['a1', 'a2']);
  assert.equal(report.championSupport.modelProfile, 'fast');
});

test('routing model provider dispatches profile calls to endpoint-specific providers', async () => {
  const calls = [];
  const defaultProvider = async (input) => {
    calls.push(['default', input.profile.name]);
    return { text: 'default response' };
  };
  const provider = createRoutingModelProvider({
    routes: {
      implementer_model: { baseUrl: 'http://fast.test/v1', modelId: 'fast-model' },
      critic: { baseUrl: 'http://critic.test/v1', modelId: 'critic-model' },
    },
    defaultProvider,
    providerFactory: (route) => async (input) => {
      calls.push([route.baseUrl, input.profile.name, input.profile.model]);
      return { text: `${route.modelId} response` };
    },
  });

  assert.deepEqual(
    await provider({ profile: { name: 'implementer_model', model: 'implementer-model' }, messages: [] }),
    { text: 'fast-model response' },
  );
  assert.deepEqual(
    await provider({ profile: { name: 'fallback_model', modelCouncilEndpointProfile: 'critic', model: 'fallback' }, messages: [] }),
    { text: 'critic-model response' },
  );
  assert.deepEqual(
    await provider({ profile: { name: 'unknown', model: 'unknown-model' }, messages: [] }),
    { text: 'default response' },
  );
  assert.deepEqual(calls, [
    ['http://fast.test/v1', 'implementer_model', 'fast-model'],
    ['http://critic.test/v1', 'fallback_model', 'critic-model'],
    ['default', 'unknown'],
  ]);
});
