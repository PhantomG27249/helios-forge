import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildPiBridgeContextPack,
  compactPiBridgeContextForSwarm,
  renderPiBridgeContextMarkdown,
} from '../src/harness-sidecar/pi/piBridgeContextPack.js';

test('buildPiBridgeContextPack returns evidence-only authority on empty workplace', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-pack-'));
  try {
    await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
    const pack = await buildPiBridgeContextPack({
      workspaceRoot,
      harnessConfig: { features: {} },
      deps: {
        loadSkillBridgeContext: async () => ({ skills: [], shadowHints: [], evidenceOnly: true, canPromote: false }),
        loadSoulBridgeContext: async () => ({ markdown: '', evidenceOnly: true, canPromote: false }),
        loadEvolutionBridgeContext: async () => ({ goals: [], evidenceOnly: true, canPromote: false }),
        loadMemoryBridgeContext: async () => null,
        loadIcrBridgeContext: async () => null,
      },
    });
    assert.equal(pack.authority.canPromote, false);
    assert.equal(pack.authority.evidenceOnly, true);
    assert.equal(pack.schemaVersion, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('renderPiBridgeContextMarkdown includes soul and evolution sections', async () => {
  const pack = {
    skills: { skills: [{ name: 'deep-research', excerpt: 'Research skill purpose' }] },
    souls: { markdown: 'Soul advisory context' },
    evolution: { goals: ['improve replay'], latestReplay: { reportId: 'r1', aggregateScore: 0.9, regressionCount: 0 } },
    promotion: { queueCount: 2 },
  };
  const markdown = renderPiBridgeContextMarkdown(pack);
  assert.match(markdown, /deep-research/);
  assert.match(markdown, /Soul advisory/);
  assert.match(markdown, /Evolution goals/);
  assert.match(markdown, /Promotion queue/);
});

test('compactPiBridgeContextForSwarm maps pack to pi-native bridge shape', () => {
  const compact = compactPiBridgeContextForSwarm({
    skills: {
      skills: [{ id: 's1', name: 'Skill', excerpt: 'excerpt' }],
      shadowHints: [{ candidateId: 'c1', name: 'Shadow', status: 'shadow_only', excerpt: 'hint' }],
    },
    souls: { agentId: 'primary', oversoulRef: { oversoulId: 'oversoul', oversoulVersion: '1' } },
    evolution: { goals: ['goal-a'], latestReplay: { reportId: 'r1', aggregateScore: 1, regressionCount: 1 } },
    promotion: { queueCount: 1 },
  });
  assert.ok(compact.skillHints.length >= 2);
  assert.ok(compact.soulRefs.length);
  assert.ok(compact.oversoulRefs.length);
  assert.ok(compact.modelWarnings.length >= 2);
  assert.equal(compact.canPromote, false);
});
