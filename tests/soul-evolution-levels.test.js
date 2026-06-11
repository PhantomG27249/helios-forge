import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVOLUTION_LEVELS,
  buildEvolutionLevelEnvelope,
  normalizeEvolutionLevelRef,
  normalizeEvolutionLevelRefs,
} from '../src/harness-sidecar/souls/evolutionLevels.js';

test('evolution levels define the recursive swarm-of-swarms stack', () => {
  assert.deepEqual(EVOLUTION_LEVELS, [
    'subagent_soul',
    'subagent_society',
    'swarm_cell',
    'swarm',
    'oversoul',
    'local_harness',
    'global_harness',
    'meta_harness',
  ]);
});

test('normalizeEvolutionLevelRef keeps only safe evidence-only lineage metadata', () => {
  const ref = normalizeEvolutionLevelRef({
    level: 'subagent_society',
    levelId: 'implementation_society',
    version: '3',
    parentRef: { level: 'swarm_cell', levelId: 'code_cell', version: '2' },
    childRefs: [
      { level: 'subagent_soul', levelId: 'coder', version: '1' },
      { level: 'subagent_soul', levelId: '../bad', version: '1', promotionAuthority: true },
    ],
    lineagePath: ['meta_harness:global', 'swarm:root', '../bad'],
    promotionAuthority: true,
    durableApplyApproved: true,
  });

  assert.equal(ref.level, 'subagent_society');
  assert.equal(ref.levelId, 'implementation_society');
  assert.equal(ref.parentRef.level, 'swarm_cell');
  assert.deepEqual(ref.childRefs.map((child) => child.levelId), ['coder']);
  assert.deepEqual(ref.lineagePath, ['meta_harness:global', 'swarm:root']);
  assert.equal(ref.evidenceOnly, true);
  assert.equal(ref.promotionAuthority, false);
  assert.equal(ref.durableApplyApproved, undefined);
});

test('normalizeEvolutionLevelRef rejects unknown levels by default', () => {
  assert.equal(normalizeEvolutionLevelRef({ level: 'unknown', levelId: 'x' }), null);
});

test('buildEvolutionLevelEnvelope aggregates parent child soul and society refs', () => {
  const envelope = buildEvolutionLevelEnvelope({
    level: 'swarm',
    levelId: 'root_swarm',
    version: '5',
    parentRef: { level: 'oversoul', levelId: 'helios', version: '1' },
    childRefs: [
      { level: 'swarm_cell', levelId: 'code_cell', version: '1' },
      { level: 'subagent_society', levelId: 'visual_society', version: '1' },
    ],
    soulRefs: { soulId: 'planner', soulVersion: '2' },
    societyRefs: [{ level: 'subagent_society', levelId: 'implementation_society', version: '1' }],
  });

  assert.equal(envelope.ref.level, 'swarm');
  assert.equal(envelope.ref.childRefs.length, 2);
  assert.equal(envelope.soulRefs.soulId, 'planner');
  assert.equal(envelope.societyRefs[0].levelId, 'implementation_society');
  assert.equal(envelope.authority, 'evidence_only');
  assert.equal(envelope.canPromote, false);
});

test('normalizeEvolutionLevelRefs handles single objects and arrays', () => {
  assert.equal(normalizeEvolutionLevelRefs({ level: 'oversoul', levelId: 'helios' }).length, 1);
  assert.equal(normalizeEvolutionLevelRefs([{ level: 'bad', levelId: 'x' }, { level: 'meta_harness', levelId: 'mh' }]).length, 1);
});
