import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadSkillBridgeContext } from '../src/harness-sidecar/pi/skillContextLoader.js';

test('loadSkillBridgeContext includes shadow skill hints', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-skill-'));
  try {
    const candidateDir = path.join(workspaceRoot, '.harness', 'meta', 'skill-candidates', 'cand-1');
    await mkdir(candidateDir, { recursive: true });
    await writeFile(path.join(candidateDir, 'candidate.json'), JSON.stringify({
      status: 'shadow_only',
      skill: { name: 'shadow-skill' },
    }), 'utf8');
    await writeFile(path.join(candidateDir, 'SKILL.md'), '# Shadow\n\n## Purpose\nAdvisory only\n', 'utf8');

    const result = await loadSkillBridgeContext({
      workspaceRoot,
      includeShadowCandidates: true,
    });
    assert.equal(result.shadowHints.length, 1);
    assert.equal(result.shadowHints[0].status, 'shadow_only');
    assert.equal(result.canPromote, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
