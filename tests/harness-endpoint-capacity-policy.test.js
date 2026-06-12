import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recommendEndpointCapacityActions } from '../src/harness-sidecar/model/endpointCapacityPolicy.js';
import { normalizeEndpointProfiles } from '../src/harness-sidecar/model/modelEndpointProfiles.js';

test('recommends evidence-only actions for degraded endpoints without changing router defaults', () => {
  const report = recommendEndpointCapacityActions({
    endpoints: {
      primary: {
        baseUrl: 'http://primary.test/v1',
        modelId: 'primary-model',
        recommendedConcurrency: 4,
      },
    },
    routerHealth: {
      primary: {
        healthy: false,
        reason: 'health_probe_failed',
        concurrency: 1,
        p95LatencyMs: 1500,
      },
    },
    policy: {
      requiredSpecialists: ['implementer'],
      routes: { implementer: 'primary' },
    },
  });

  assert.equal(report.authority, 'evidence_only');
  assert.equal(report.canPromote, false);
  assert.equal(report.recommendationOnly, true);
  assert.equal(report.autoProcurementAllowed, false);
  assert.equal(report.routerDefaultsChanged, false);
  assert.equal(report.actions.some((action) => action.type === 'endpoint.degraded'), true);
  assert.equal(report.actions.some((action) => action.action === 'reduce_or_pause_endpoint'), true);
  assert.deepEqual(report.routeRecommendations.implementer, {
    endpointProfile: 'primary',
    allowed: false,
    blockedReasons: ['health_probe_failed'],
  });
});

test('redacts health reasons and returns model-safe endpoint summaries', () => {
  const report = recommendEndpointCapacityActions({
    endpoints: {
      primary: {
        baseUrl: 'https://internal.example.test/v1',
        modelId: 'primary-model',
        apiKeyEnv: 'OPENAI_API_KEY',
        estimatedCostUsdPer1kTokens: 0.01,
      },
    },
    routerHealth: {
      primary: {
        healthy: false,
        reason: 'failed Authorization: Bearer secret-token api_key=abc123',
      },
    },
    policy: {
      routes: { implementer: 'primary' },
    },
  });
  const visible = JSON.stringify(report);

  assert.equal(visible.includes('secret-token'), false);
  assert.equal(visible.includes('abc123'), false);
  assert.equal(visible.includes('https://internal.example.test'), false);
  assert.equal(visible.includes('OPENAI_API_KEY'), false);
  assert.equal(report.endpoints.primary.baseUrl, undefined);
  assert.equal(report.endpoints.primary.apiKeyEnv, undefined);
  assert.equal(report.actions[0].reason, 'health_probe_failed');
  assert.equal(report.actions[0].evidence.reason, 'health_probe_failed');
});

test('flags missing specialist routes and missing model profiles as capacity gaps', () => {
  const report = recommendEndpointCapacityActions({
    endpoints: {
      primary: {
        baseUrl: 'http://primary.test/v1',
        modelId: 'primary-model',
      },
    },
    policy: {
      requiredSpecialists: ['implementer', 'reviewer', 'visual-specialist'],
      requiredModelProfiles: ['primary-model', 'critic-model'],
      routes: {
        implementer: 'primary',
        reviewer: 'critic',
      },
    },
  });

  assert.deepEqual(
    report.actions.map((action) => action.type),
    [
      'model_endpoint.missing_specialist_route',
      'model_endpoint.missing_specialist_endpoint',
      'model_endpoint.missing_model_profile',
    ],
  );
  assert.equal(report.actions[0].role, 'visual-specialist');
  assert.equal(report.actions[1].endpointProfile, 'critic');
  assert.equal(report.actions[2].modelProfile, 'critic-model');
  assert.equal(report.summary.blockedRouteCount, 2);
});

test('blocks routes that exceed cost or latency ceilings', () => {
  const report = recommendEndpointCapacityActions({
    endpoints: {
      expensive: {
        baseUrl: 'http://expensive.test/v1',
        modelId: 'expensive-model',
        estimatedCostUsdPer1kTokens: 0.09,
        targetLatencyMs: 2000,
      },
      slow: {
        baseUrl: 'http://slow.test/v1',
        modelId: 'slow-model',
        estimatedCostUsdPer1kTokens: 0.01,
      },
    },
    routerHealth: {
      slow: { healthy: true, p95LatencyMs: 3200 },
    },
    policy: {
      maxEstimatedCostUsdPer1kTokens: 0.05,
      maxP95LatencyMs: 2500,
      routes: {
        implementer: 'expensive',
        reviewer: 'slow',
      },
    },
    budget: {
      maxEstimatedCostUsdPer1kTokens: 0.04,
    },
  });

  assert.deepEqual(report.routeRecommendations.implementer.blockedReasons, ['cost_ceiling_exceeded']);
  assert.deepEqual(report.routeRecommendations.reviewer.blockedReasons, ['latency_ceiling_exceeded']);
  assert.equal(report.actions.some((action) => action.type === 'model_endpoint.cost_ceiling_exceeded'), true);
  assert.equal(report.actions.some((action) => action.type === 'model_endpoint.latency_ceiling_exceeded'), true);
});

test('keeps auto-procurement disabled even when procurement is requested by policy', () => {
  const report = recommendEndpointCapacityActions({
    endpoints: {},
    policy: {
      autoProcurementEnabled: true,
      requiredSpecialists: ['reviewer'],
      routes: { reviewer: 'critic' },
    },
  });

  assert.equal(report.autoProcurementAllowed, false);
  assert.equal(report.actions.some((action) => action.type === 'model_endpoint.auto_procurement_disabled'), true);
  assert.equal(report.actions.every((action) => action.recommendationOnly === true), true);
  assert.equal(report.actions.every((action) => action.canProcure === false), true);
});

test('blocks VLM image routes when the endpoint cannot handle image inputs', () => {
  const report = recommendEndpointCapacityActions({
    endpoints: {
      textOnly: {
        baseUrl: 'http://text-only.test/v1',
        modelId: 'text-model',
        supportsVision: false,
      },
    },
    policy: {
      routes: {
        'visual-specialist': 'textOnly',
      },
      routeRequirements: {
        'visual-specialist': { requiresVision: true },
      },
    },
  });

  assert.deepEqual(report.routeRecommendations['visual-specialist'].blockedReasons, ['vision_capability_mismatch']);
  assert.equal(report.actions[0].type, 'model_endpoint.vision_capability_mismatch');
  assert.equal(report.actions[0].action, 'recommend_vision_capable_endpoint');
});

test('normalizes endpoint capacity metadata used by recommendations', () => {
  const profiles = normalizeEndpointProfiles({
    fast: {
      baseUrl: ' http://fast.test/v1 ',
      modelId: 'fast-model',
      estimatedCostUsdPer1kTokens: '0.012',
      targetLatencyMs: '1200',
      maxContextTokens: '131072',
      capabilities: ['text', 'image'],
    },
  });

  assert.deepEqual(profiles.fast.capabilities, ['text', 'image']);
  assert.equal(profiles.fast.estimatedCostUsdPer1kTokens, 0.012);
  assert.equal(profiles.fast.targetLatencyMs, 1200);
  assert.equal(profiles.fast.maxContextTokens, 131072);
});
