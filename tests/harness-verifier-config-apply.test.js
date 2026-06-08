import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { executeApprovedApplyAction } from '../src/harness-sidecar/core/approvalResume.js';
import { applyVerifierConfigCandidate } from '../src/harness-sidecar/tools/verifierConfigApply.js';

async function makeWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-verifier-apply-'));
  await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
  await writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({
    scripts: { test: 'node --test' },
  }), 'utf8');
  return workspaceRoot;
}

async function readVerifiers(workspaceRoot) {
  return JSON.parse(await readFile(path.join(workspaceRoot, '.harness', 'verifiers.json'), 'utf8'));
}

test('applies approved verifier candidate, preserves existing records, and writes backup', async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(path.join(workspaceRoot, '.harness', 'verifiers.json'), JSON.stringify({
    version: 1,
    verifiers: [{
      name: 'existing-unit',
      command: 'npm test',
      kind: 'unit',
      appliesTo: ['**/*.js'],
      tags: ['existing'],
    }],
  }, null, 2), 'utf8');

  const result = await applyVerifierConfigCandidate({
    workspaceRoot,
    approval: { approved: true, approvedBy: 'operator' },
    candidate: {
      candidateId: 'vg_visual_candidate',
      verifier: {
        name: 'visual-ui',
        kind: 'visual',
        tool: 'visual.verifier.run',
        risk: 'medium',
        appliesTo: ['public/**/*.js', 'public/**/*.html'],
        tags: ['visual', 'ui'],
        rubric: { strictness: 'balanced' },
      },
    },
  });

  const config = await readVerifiers(workspaceRoot);
  const names = config.verifiers.map((verifier) => verifier.name);
  const backups = (await readdir(path.join(workspaceRoot, '.harness')))
    .filter((name) => /^verifiers\.backup\..+\.json$/.test(name));

  assert.equal(result.status, 'applied');
  assert.equal(result.candidateId, 'vg_visual_candidate');
  assert.deepEqual(names, ['existing-unit', 'visual-ui']);
  assert.equal(config.verifiers[1].tool, 'visual.verifier.run');
  assert.equal(backups.length, 1);
});

test('refuses verifier candidate apply without approval action', async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(path.join(workspaceRoot, '.harness', 'verifiers.json'), JSON.stringify({ version: 1, verifiers: [] }), 'utf8');

  const result = await applyVerifierConfigCandidate({
    workspaceRoot,
    candidate: {
      candidateId: 'vg_missing_approval',
      verifier: {
        name: 'visual-ui',
        kind: 'visual',
        tool: 'visual.verifier.run',
        appliesTo: ['public/**/*.js'],
      },
    },
    approval: { approved: false },
  });

  const config = await readVerifiers(workspaceRoot);

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'approval_required');
  assert.deepEqual(config.verifiers, []);
});

test('rejects unsafe command, tool, and cwd before mutating verifier config', async () => {
  const workspaceRoot = await makeWorkspace();
  const initial = { version: 1, verifiers: [] };
  await writeFile(path.join(workspaceRoot, '.harness', 'verifiers.json'), JSON.stringify(initial, null, 2), 'utf8');

  for (const verifier of [
    { name: 'bad-command', command: 'npm test && node steal.js' },
    { name: 'bad-tool', tool: 'visual verifier/run' },
    { name: 'bad-cwd', command: 'npm test', cwd: '..' },
  ]) {
    await assert.rejects(
      applyVerifierConfigCandidate({
        workspaceRoot,
        approval: { approved: true, approvedBy: 'operator' },
        candidate: { candidateId: 'vg_unsafe_candidate', verifier },
      }),
      /Unsafe|outside workspace|invalid tool|must define exactly one/,
    );
  }

  assert.deepEqual(await readVerifiers(workspaceRoot), initial);
});

test('approval resume helper applies verifier config candidate only after approval', async () => {
  const workspaceRoot = await makeWorkspace();
  await writeFile(path.join(workspaceRoot, '.harness', 'verifiers.json'), JSON.stringify({ version: 1, verifiers: [] }), 'utf8');

  const rejected = await executeApprovedApplyAction({
    workspaceRoot,
    approved: false,
    action: {
      actionId: 'act_verifier_reject',
      taskId: 'task_verifier',
      kind: 'verifier_config_apply',
      payload: {
        candidate: {
          candidateId: 'vg_resume_candidate',
          verifier: { name: 'visual-ui', kind: 'visual', tool: 'visual.verifier.run' },
        },
      },
    },
  });

  assert.equal(rejected.status, 'rejected');
  assert.equal((await readVerifiers(workspaceRoot)).verifiers.length, 0);

  const applied = await executeApprovedApplyAction({
    workspaceRoot,
    approved: true,
    action: {
      actionId: 'act_verifier_apply',
      taskId: 'task_verifier',
      kind: 'verifier_config_apply',
      payload: {
        candidate: {
          candidateId: 'vg_resume_candidate',
          verifier: { name: 'visual-ui', kind: 'visual', tool: 'visual.verifier.run' },
        },
      },
    },
  });

  assert.equal(applied.status, 'applied');
  assert.equal((await readVerifiers(workspaceRoot)).verifiers[0].name, 'visual-ui');
});
