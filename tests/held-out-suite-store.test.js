import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { normalizeHeldOutSuite } from '../src/harness-sidecar/benchmarks/heldOutSuiteSchema.js';
import { createHeldOutSuiteStore } from '../src/harness-sidecar/benchmarks/heldOutSuiteStore.js';

function validSuite(overrides = {}) {
  return {
    id: 'stable-suite',
    domains: ['code'],
    cases: [{
      id: 'case-1',
      domain: 'code',
      description: 'Replay the canonical refactor case.',
      fixtureRef: 'fixtures/code/case-1.json',
      expectedEvidence: ['replay'],
    }],
    ...overrides,
  };
}

test('held-out suite requires id, domains, and cases', () => {
  assert.throws(() => normalizeHeldOutSuite({ domains: ['code'], cases: [] }), /id/);
  assert.throws(() => normalizeHeldOutSuite({ id: 'missing-domains', cases: [] }), /domains/);
  assert.throws(() => normalizeHeldOutSuite({ id: 'missing-cases', domains: ['code'] }), /cases/);
});

test('held-out suite accepts every supported domain and rejects unknown domains', () => {
  const normalized = normalizeHeldOutSuite(validSuite({
    domains: ['safety', 'swarm', 'tool', 'visual', 'memory', 'research', 'code'],
  }));

  assert.deepEqual(normalized.domains, [
    'code',
    'memory',
    'research',
    'safety',
    'swarm',
    'tool',
    'visual',
  ]);
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({ domains: ['code', 'finance'] })),
    /domain/,
  );
});

test('held-out suite accepts supported metric weights and rejects unknown weights', () => {
  const normalized = normalizeHeldOutSuite(validSuite({
    metricWeights: {
      trustRisk: 0.1,
      quality: 0.25,
      safety: 0.2,
      reliability: 0.15,
      cost: 0.05,
      latency: 0.05,
      maintainability: 0.1,
      visualConfidence: 0.05,
      memoryHealth: 0.05,
    },
  }));

  assert.deepEqual(Object.keys(normalized.metricWeights), [
    'cost',
    'latency',
    'maintainability',
    'memoryHealth',
    'quality',
    'reliability',
    'safety',
    'trustRisk',
    'visualConfidence',
  ]);
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({ metricWeights: { accuracy: 1 } })),
    /metricWeights/,
  );
});

test('held-out suite rejects non-numeric metric weights except numeric strings', () => {
  const normalized = normalizeHeldOutSuite(validSuite({
    metricWeights: { quality: '0.75' },
  }));

  assert.equal(normalized.metricWeights.quality, 0.75);
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({ metricWeights: { quality: '' } })),
    /metricWeights\.quality/,
  );
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({ metricWeights: { reliability: null } })),
    /metricWeights\.reliability/,
  );
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({ metricWeights: { safety: false } })),
    /metricWeights\.safety/,
  );
});

test('held-out suite preserves quarantine flags as evidence metadata', () => {
  const normalized = normalizeHeldOutSuite(validSuite({
    quarantine: { quarantined: true, reasons: ['external_fixture'] },
    cases: [{
      id: 'case-1',
      domain: 'code',
      fixtureRef: 'fixtures/code/case-1.json',
      expectedEvidence: ['replay'],
      quarantine: { quarantined: true, reasons: ['needs_review'] },
    }],
  }));

  assert.deepEqual(normalized.quarantine, {
    quarantined: true,
    reasons: ['external_fixture'],
  });
  assert.deepEqual(normalized.cases[0].quarantine, {
    quarantined: true,
    reasons: ['needs_review'],
  });
});

test('held-out suite rejects unsafe expected evidence and quarantine reason text', () => {
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({
      cases: [{
        id: 'case-1',
        fixtureRef: 'fixtures/code/case-1.json',
        expectedEvidence: ['token=ghp_should_not_leak'],
      }],
    })),
    /expectedEvidence/,
  );
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({
      quarantine: { quarantined: true, reasons: ['../outside'] },
    })),
    /quarantine\.reasons/,
  );
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({
      cases: [{
        id: 'case-1',
        fixtureRef: 'fixtures/code/case-1.json',
        quarantine: { quarantined: true, reasons: ['C:\\Users\\jackj\\secret.txt'] },
      }],
    })),
    /quarantine\.reasons/,
  );
});

test('held-out suite rejects traversal fixture refs', () => {
  assert.throws(() => normalizeHeldOutSuite({
    id: 'bad',
    domains: ['code'],
    cases: [{ id: 'case-1', fixtureRef: '../secret.txt', expectedEvidence: ['replay'] }],
  }), /fixtureRef/);
});

test('held-out suite rejects absolute fixture refs and unsafe suite ids', () => {
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({
      cases: [{ id: 'case-1', fixtureRef: 'C:\\Users\\jackj\\secret.txt' }],
    })),
    /fixtureRef/,
  );
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({ id: '../bad' })),
    /id/,
  );
});

test('held-out suite rejects duplicate case ids', () => {
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({
      cases: [
        { id: 'case-1', fixtureRef: 'fixtures/code/a.json' },
        { id: 'case-1', fixtureRef: 'fixtures/code/b.json' },
      ],
    })),
    /duplicate case id/,
  );
});

test('held-out suite rejects model-visible secret-shaped descriptions and fixture refs', () => {
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({ description: 'Use token=ghp_should_not_leak' })),
    /description/,
  );
  assert.throws(
    () => normalizeHeldOutSuite(validSuite({
      cases: [{ id: 'case-1', fixtureRef: 'fixtures/sk-should-not-leak.json' }],
    })),
    /fixtureRef/,
  );
});

test('held-out suite normalization is deterministic', () => {
  const normalized = normalizeHeldOutSuite(validSuite({
    domains: ['visual', 'code'],
    metricWeights: { reliability: 0.25, quality: 0.75 },
    cases: [
      { id: 'case-b', domain: 'visual', fixtureRef: 'fixtures/b.json' },
      { id: 'case-a', domain: 'code', fixtureRef: 'fixtures/a.json' },
    ],
  }));

  assert.equal(
    JSON.stringify(normalized, null, 2),
    JSON.stringify(normalizeHeldOutSuite(normalized), null, 2),
  );
  assert.deepEqual(normalized.cases.map((benchmarkCase) => benchmarkCase.id), ['case-a', 'case-b']);
});

test('held-out suite store persists only under the suite manifest directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-held-out-suite-'));
  try {
    const store = createHeldOutSuiteStore({ workspaceRoot });
    const saved = await store.saveSuite(validSuite({ id: 'suite-one' }));
    const expectedPath = path.join(
      workspaceRoot,
      '.harness',
      'benchmarks',
      'suites',
      'suite-one.json',
    );

    assert.equal(store.suitePath('suite-one'), expectedPath);
    assert.equal(saved.id, 'suite-one');
    assert.equal(await readFile(expectedPath, 'utf8'), `${JSON.stringify(saved, null, 2)}\n`);
    assert.deepEqual(await store.loadSuite('suite-one'), saved);
    assert.deepEqual(await store.listSuites(), [saved]);
    assert.throws(() => store.suitePath('../suite-one'), /suite id/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('held-out suite store checks existing ancestors before creating suite directories', async () => {
  const workspaceRoot = path.join(tmpdir(), 'helios-held-out-suite-symlink-order');
  const calls = [];
  const fsImpl = {
    async lstat(target) {
      calls.push(['lstat', target]);
      return {
        isSymbolicLink: () => path.basename(target) === '.harness',
      };
    },
    async mkdir(target) {
      calls.push(['mkdir', target]);
    },
    async realpath(target) {
      calls.push(['realpath', target]);
      return target;
    },
    async writeFile(target) {
      calls.push(['writeFile', target]);
    },
    async readFile() {
      throw new Error('readFile should not be reached');
    },
    async readdir() {
      return [];
    },
  };

  const store = createHeldOutSuiteStore({ workspaceRoot, fsImpl });
  await assert.rejects(
    () => store.saveSuite(validSuite({ id: 'suite-symlink' })),
    /symlink or junction/,
  );

  assert.equal(calls.some(([name]) => name === 'mkdir'), false);
});
