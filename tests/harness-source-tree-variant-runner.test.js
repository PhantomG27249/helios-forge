import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createHarnessVariantWorkspace,
  readHarnessVariantProposerContext,
} from '../src/harness-sidecar/meta/harnessVariantWorkspace.js';
import { createSourceTreeVariantRunner } from '../src/harness-sidecar/meta/sourceTreeVariantRunner.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-source-tree-variant-'));
  try {
    await mkdir(path.join(workspaceRoot, 'src', 'harness-sidecar', 'meta'), { recursive: true });
    await mkdir(path.join(workspaceRoot, 'config'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'package.json'), '{"type":"module"}\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'worker-seven-extra.md'), 'root source file\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'worker-seven.config.json'), '{"rootConfig":true}\n', 'utf8');
    await writeFile(
      path.join(workspaceRoot, 'src', 'harness-sidecar', 'meta', 'entrypoint.js'),
      'export const variantEntrypoint = true;\n',
      'utf8',
    );
    await writeFile(path.join(workspaceRoot, 'config', 'variant.json'), '{"threshold":0.9}\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'ACTIVE_WORKSPACE_SENTINEL.txt'), 'unchanged\n', 'utf8');
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function createVariant(workspaceRoot, candidateId = 'cand_source_tree') {
  return createHarnessVariantWorkspace({
    workspaceRoot,
    cycleId: 'cycle_source_tree',
    candidate: { candidateId, target: 'meta-harness' },
    config: { existingManifest: true },
    traceManifest: { traces: [] },
    metricManifest: { metrics: [] },
  });
}

test('source tree runner materializes a runnable full-tree variant under the existing variant root', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const variant = await createVariant(workspaceRoot);
    const runner = createSourceTreeVariantRunner({
      workspaceRoot,
      variantRoot: variant.variantDir,
      commandRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });

    const prepared = await runner.prepareVariant({
      entrypoint: 'src/harness-sidecar/meta/entrypoint.js',
      configPaths: ['config/variant.json'],
    });

    assert.equal(prepared.variantRoot, variant.variantDir);
    assert.equal(prepared.entrypoint, 'src/harness-sidecar/meta/entrypoint.js');
    assert.equal(
      await readFile(path.join(variant.variantDir, 'source-tree', 'src', 'harness-sidecar', 'meta', 'entrypoint.js'), 'utf8'),
      'export const variantEntrypoint = true;\n',
    );
    await assert.rejects(
      readFile(path.join(variant.variantDir, 'source-tree', '.harness', 'meta', 'harness-variants'), 'utf8'),
      /ENOENT/,
    );

    const manifest = JSON.parse(await readFile(variant.files.manifest, 'utf8'));
    assert.equal(manifest.artifacts.sourceTree.path, 'source-tree');
    assert.equal(manifest.artifacts.sourceTree.entrypoint, 'src/harness-sidecar/meta/entrypoint.js');
    assert.equal(manifest.safeApply.activeWorkspaceMutation, false);
  });
});

test('source tree runner materializes non-default root source and config files by default', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const variant = await createVariant(workspaceRoot, 'cand_full_tree');
    const runner = createSourceTreeVariantRunner({
      workspaceRoot,
      variantRoot: variant.variantDir,
      commandRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });

    await runner.prepareVariant({
      entrypoint: 'src/harness-sidecar/meta/entrypoint.js',
    });

    assert.equal(
      await readFile(path.join(variant.variantDir, 'source-tree', 'worker-seven-extra.md'), 'utf8'),
      'root source file\n',
    );
    assert.equal(
      await readFile(path.join(variant.variantDir, 'source-tree', 'worker-seven.config.json'), 'utf8'),
      '{"rootConfig":true}\n',
    );
  });
});

test('source tree runner allows only explicit executable entrypoints and records run evidence', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const variant = await createVariant(workspaceRoot, 'cand_command');
    const calls = [];
    const runner = createSourceTreeVariantRunner({
      workspaceRoot,
      variantRoot: variant.variantDir,
      commandRunner: async (command) => {
        calls.push(command);
        return { exitCode: 0, stdout: 'ok', stderr: '' };
      },
    });

    await runner.prepareVariant({ entrypoint: 'src/harness-sidecar/meta/entrypoint.js' });
    await assert.rejects(
      runner.runVariant({ command: 'powershell', args: ['-NoProfile'] }),
      /not allowlisted/,
    );
    await assert.rejects(
      runner.runVariant({ command: '..\\node.exe', args: [] }),
      /Unsafe command/,
    );
    await assert.rejects(
      runner.runVariant({ command: 'node', args: [path.join(workspaceRoot, 'src', 'harness-sidecar', 'meta', 'entrypoint.js')] }),
      /Unsafe command argument/,
    );
    await assert.rejects(
      runner.runVariant({
        command: 'node',
        args: [`--input=${path.join(workspaceRoot, 'src', 'harness-sidecar', 'meta', 'entrypoint.js').replaceAll(path.sep, '/')}`],
      }),
      /Unsafe command argument/,
    );

    const run = await runner.runVariant({
      command: 'node',
      args: ['src/harness-sidecar/meta/entrypoint.js'],
      env: { HELIOS_VARIANT: '1' },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].cwd, path.join(variant.variantDir, 'source-tree'));
    assert.deepEqual(calls[0].args, ['src/harness-sidecar/meta/entrypoint.js']);
    assert.equal(calls[0].env.HELIOS_VARIANT, '1');
    assert.equal(run.result.exitCode, 0);

    const runEvidence = JSON.parse(await readFile(path.join(variant.variantDir, 'run-evidence.json'), 'utf8'));
    assert.equal(runEvidence.command, 'node');
    assert.deepEqual(runEvidence.args, ['src/harness-sidecar/meta/entrypoint.js']);
    assert.equal(runEvidence.result.stdout, 'ok');
    assert.equal(runEvidence.evidenceOnly, true);
  });
});

test('source tree runner captures source config trace metric and replay artifacts without active workspace mutation', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const variant = await createVariant(workspaceRoot, 'cand_artifacts');
    const runner = createSourceTreeVariantRunner({
      workspaceRoot,
      variantRoot: variant.variantDir,
      commandRunner: async ({ cwd }) => {
        await mkdir(path.join(cwd, '.harness', 'traces', 'run_1'), { recursive: true });
        await mkdir(path.join(cwd, '.harness', 'metrics'), { recursive: true });
        await mkdir(path.join(cwd, '.harness', 'replays'), { recursive: true });
        await writeFile(path.join(cwd, '.harness', 'traces', 'run_1', 'events.jsonl'), '{"event":"variant"}\n', 'utf8');
        await writeFile(path.join(cwd, '.harness', 'metrics', 'score.json'), '{"quality":0.88}\n', 'utf8');
        await writeFile(path.join(cwd, '.harness', 'replays', 'case.json'), '{"caseId":"case_1"}\n', 'utf8');
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    await runner.prepareVariant({
      entrypoint: 'src/harness-sidecar/meta/entrypoint.js',
      configPaths: ['config/variant.json'],
    });
    await runner.runVariant({ command: 'node', args: ['src/harness-sidecar/meta/entrypoint.js'] });
    const collected = await runner.collectArtifacts({
      tracePaths: ['.harness/traces/run_1/events.jsonl'],
      metricPaths: ['.harness/metrics/score.json'],
      replayPaths: ['.harness/replays/case.json'],
    });

    assert.ok(collected.artifacts.source.files.some((file) => file.path === 'source-tree/package.json'));
    assert.ok(collected.artifacts.source.files.some((file) => file.path === 'source-tree/src/harness-sidecar/meta/entrypoint.js'));
    assert.deepEqual(collected.artifacts.config.files.map((file) => file.path), ['source-tree/config/variant.json']);
    assert.deepEqual(collected.artifacts.trace.files.map((file) => file.path), ['variant-artifacts/traces/run_1/events.jsonl']);
    assert.deepEqual(collected.artifacts.metrics.files.map((file) => file.path), ['variant-artifacts/metrics/score.json']);
    assert.deepEqual(collected.artifacts.replay.files.map((file) => file.path), ['variant-artifacts/replays/case.json']);
    assert.equal(
      await readFile(path.join(workspaceRoot, 'ACTIVE_WORKSPACE_SENTINEL.txt'), 'utf8'),
      'unchanged\n',
    );

    const manifest = JSON.parse(await readFile(variant.files.manifest, 'utf8'));
    assert.equal(
      await readFile(path.join(variant.variantDir, manifest.artifacts.config.files[0].path), 'utf8'),
      '{"threshold":0.9}\n',
    );
    assert.equal(manifest.artifacts.replay.files[0].path, 'variant-artifacts/replays/case.json');
    assert.equal(manifest.safeApply.activeWorkspaceMutation, false);
  });
});

test('collected source artifacts remain readable by existing proposer context readers', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const variant = await createVariant(workspaceRoot, 'cand_context_readable');
    const runner = createSourceTreeVariantRunner({
      workspaceRoot,
      variantRoot: variant.variantDir,
      commandRunner: async ({ cwd }) => {
        await mkdir(path.join(cwd, '.harness', 'metrics'), { recursive: true });
        await writeFile(path.join(cwd, '.harness', 'metrics', 'score.json'), '{"quality":0.91}\n', 'utf8');
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    await runner.prepareVariant({
      entrypoint: 'src/harness-sidecar/meta/entrypoint.js',
    });
    await runner.runVariant({ command: 'node', args: ['src/harness-sidecar/meta/entrypoint.js'] });
    await runner.collectArtifacts({
      metricPaths: ['.harness/metrics/score.json'],
    });

    const context = await readHarnessVariantProposerContext({
      workspaceRoot,
      variantRefs: [variant],
    });

    assert.equal(context.priorVariants[0].variantId, 'cand_context_readable');
    assert.ok(context.priorVariants[0].sourceSummaries.some((summary) => (
      summary.path === 'source-tree/src/harness-sidecar/meta/entrypoint.js'
        && summary.excerpt.includes('variantEntrypoint')
    )));
    assert.equal(context.priorVariants[0].metricSummaries[0].json.quality, 0.91);
  });
});

test('source tree runner preserves variant manifest compatibility and symlink-safe boundaries', async (t) => {
  await withWorkspace(async (workspaceRoot) => {
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'helios-source-tree-outside-'));
    const sourceTreeDir = path.join(
      workspaceRoot,
      '.harness',
      'meta',
      'harness-variants',
      'cycle_source_tree',
      'cand_link',
      'source-tree',
    );
    await mkdir(path.dirname(sourceTreeDir), { recursive: true });
    try {
      await symlink(outsideRoot, sourceTreeDir, 'junction');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        await rm(outsideRoot, { recursive: true, force: true });
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    const variant = await createVariant(workspaceRoot, 'cand_link');
    const manifestBefore = JSON.parse(await readFile(variant.files.manifest, 'utf8'));
    assert.equal(manifestBefore.artifacts.config.path, 'config.json');
    assert.equal(manifestBefore.artifacts.trace.path, 'trace-manifest.json');
    assert.equal(manifestBefore.artifacts.metrics.path, 'metric-manifest.json');

    const runner = createSourceTreeVariantRunner({
      workspaceRoot,
      variantRoot: variant.variantDir,
      commandRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });

    await assert.rejects(
      runner.prepareVariant({ entrypoint: 'src/harness-sidecar/meta/entrypoint.js' }),
      /symlink|junction|escapes workspace/i,
    );
    await assert.rejects(
      readFile(path.join(outsideRoot, 'package.json'), 'utf8'),
      /ENOENT/,
    );
    await rm(outsideRoot, { recursive: true, force: true });
  });
});
