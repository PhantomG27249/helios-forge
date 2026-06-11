import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSoulMutationCandidate, createSoulVariantWorkspace } from '../src/harness-sidecar/souls/soulEvolution.js';

test('createSoulMutationCandidate creates shadow-only soul and oversoul mutation candidates', () => {
  const candidate = createSoulMutationCandidate({
    candidateId: 'soul_candidate_1',
    target: 'soul',
    operation: 'distill',
    soulId: 'implementer',
    soulVersion: '1',
    markdown: '# Soul: implementer',
    evidenceRefs: ['trace:1'],
    evolutionLevel: { level: 'subagent_soul', levelId: 'implementer', version: '1' },
    parentLevelRef: { level: 'subagent_society', levelId: 'implementation_society', version: '1' },
    childLevelRefs: [{ level: 'subagent_soul', levelId: 'verifier', version: '1' }],
    societyRefs: [{ level: 'subagent_society', levelId: 'implementation_society', version: '1' }],
  });

  assert.equal(candidate.status, 'shadow_only');
  assert.equal(candidate.promotionAuthority, false);
  assert.equal(candidate.operation, 'distill');
  assert.equal(candidate.soulRefs.soulId, 'implementer');
  assert.equal(candidate.evolutionLevelRef.level, 'subagent_soul');
  assert.equal(candidate.evolutionLevelRef.parentRef.levelId, 'implementation_society');
  assert.equal(candidate.evolutionLevelRef.childRefs[0].levelId, 'verifier');
  assert.equal(candidate.societyRefs[0].levelId, 'implementation_society');
});

test('createSoulVariantWorkspace materializes soul files as evidence-only harness variants', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-soul-variant-'));
  try {
    const variant = await createSoulVariantWorkspace({
      workspaceRoot,
      cycleId: 'soul_cycle_1',
      candidate: createSoulMutationCandidate({
        candidateId: 'soul_candidate_1',
        target: 'oversoul',
        operation: 'fork_oversoul',
        oversoulVersion: '1',
        markdown: '# Oversoul: helios',
      }),
    });

    assert.equal(variant.manifest.safeApply.promotionAuthority, false);
    assert.equal(variant.manifest.artifacts.source[0].path, 'src/.harness/souls/oversoul-candidates/soul_candidate_1/oversoul.md');
    assert.equal(variant.manifest.lineage.evolutionLevelRef.level, 'oversoul');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
