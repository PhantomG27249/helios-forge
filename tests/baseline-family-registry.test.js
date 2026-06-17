import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getBaselineFamily,
  listBaselineFamilies,
} from '../src/harness-sidecar/benchmarks/baselineFamilyRegistry.js';

const EXPECTED_FAMILY_IDS = ['forward_only', 'rho_only', 'bes_rho', 'full_stack'];

test('listBaselineFamilies returns all registered baseline families', () => {
  const families = listBaselineFamilies();

  assert.equal(families.length, EXPECTED_FAMILY_IDS.length);
  assert.deepEqual(families.map((family) => family.id), EXPECTED_FAMILY_IDS);
});

test('getBaselineFamily returns family metadata for known ids', () => {
  for (const id of EXPECTED_FAMILY_IDS) {
    const family = getBaselineFamily(id);

    assert.ok(family, `expected family for ${id}`);
    assert.equal(family.id, id);
    assert.equal(typeof family.label, 'string');
    assert.ok(family.label.length > 0);
    assert.equal(typeof family.description, 'string');
    assert.ok(family.description.length > 0);
    assert.equal(family.evidenceOnly, true);
    assert.equal(family.canPromote, false);
    assert.equal(typeof family.layers, 'object');
    assert.notEqual(family.layers, null);
  }
});

test('baseline families encode progressively richer harness layers', () => {
  const forwardOnly = getBaselineFamily('forward_only');
  const rhoOnly = getBaselineFamily('rho_only');
  const besRho = getBaselineFamily('bes_rho');
  const fullStack = getBaselineFamily('full_stack');

  assert.equal(forwardOnly.layers.forward, true);
  assert.equal(forwardOnly.layers.rho, false);
  assert.equal(forwardOnly.layers.bes, false);
  assert.equal(forwardOnly.layers.swarm, false);

  assert.equal(rhoOnly.layers.rho, true);
  assert.equal(rhoOnly.layers.bes, false);

  assert.equal(besRho.layers.rho, true);
  assert.equal(besRho.layers.bes, true);
  assert.equal(besRho.layers.swarm, false);

  assert.equal(fullStack.layers.rho, true);
  assert.equal(fullStack.layers.bes, true);
  assert.equal(fullStack.layers.swarm, true);
});

test('getBaselineFamily returns null for unknown ids', () => {
  assert.equal(getBaselineFamily('unknown'), null);
  assert.equal(getBaselineFamily(''), null);
  assert.equal(getBaselineFamily(null), null);
});
