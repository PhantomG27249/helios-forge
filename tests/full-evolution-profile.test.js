import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyFullEvolutionProfile, fullEvolutionProfileActive } from '../src/harness-sidecar/meta/fullEvolutionProfile.js';

test('applyFullEvolutionProfile enables production gates and pi bridge profile', () => {
  const config = applyFullEvolutionProfile({ features: {} });
  assert.equal(config.features.skillEvolution, true);
  assert.equal(config.evolution.promotionOrchestration, true);
  assert.equal(config.productionCapabilities.productionAutonomyPolicy.enabled, true);
  assert.equal(config.piBridge.fullLeverageProfile, true);
  assert.equal(fullEvolutionProfileActive(config), true);
});
