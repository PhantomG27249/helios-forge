import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadVerifierRegistry } from '../src/harness-sidecar/tools/verifierRegistry.js';
import { runVerifiers } from '../src/harness-sidecar/tools/verifierRunner.js';

const nodeCommand = `"${process.execPath}"`;

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-verifier-registry-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('verifier registry derives safe defaults from package scripts', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({
      scripts: {
        test: 'node --test',
        'release:smoke': 'node scripts/release-smoke.js',
      },
    }));

    const registry = await loadVerifierRegistry({ workspaceRoot });

    assert.equal(registry.version, 1);
    assert.deepEqual(registry.verifiers.map((verifier) => verifier.name), ['unit', 'release-smoke']);
    assert.equal(registry.byName.unit.command, 'npm test');
    assert.equal(registry.byName['release-smoke'].command, 'npm run release:smoke');
    assert.equal(registry.byName.unit.cwd, null);
  });
});

test('verifier registry loads json and yaml harness verifier records', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    await writeFile(path.join(harnessDir, 'verifiers.json'), JSON.stringify({
      version: 1,
      verifiers: [{
        name: 'vlm-focused',
        command: 'npm test -- tests/harness-vlm-native.test.js',
        kind: 'visual',
        cwd: '.',
        appliesTo: ['src/harness-sidecar/vlm/**/*.js'],
        tags: ['vlm'],
      }],
    }));

    let registry = await loadVerifierRegistry({ workspaceRoot });
    assert.equal(registry.byName['vlm-focused'].kind, 'visual');
    assert.deepEqual(registry.byName['vlm-focused'].appliesTo, ['src/harness-sidecar/vlm/**/*.js']);

    await rm(path.join(harnessDir, 'verifiers.json'));
    await writeFile(path.join(harnessDir, 'verifiers.yaml'), [
      'version: 1',
      'verifiers:',
      '  - name: smoke',
      '    command: npm run release:smoke',
      '    kind: smoke',
      '    risk: medium',
      '    timeoutMs: 90000',
      '    appliesTo:',
      '      - src/**/*.js',
      '    tags:',
      '      - default',
      '',
    ].join('\n'));

    registry = await loadVerifierRegistry({ workspaceRoot });
    assert.equal(registry.byName.smoke.command, 'npm run release:smoke');
    assert.equal(registry.byName.smoke.timeoutMs, 90000);
    assert.deepEqual(registry.byName.smoke.tags, ['default']);
  });
});

test('verifier registry loads visual tool verifier records without commands', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(path.join(harnessDir, 'verifiers.json'), JSON.stringify({
      version: 1,
      verifiers: [{
        name: 'visual-ui',
        kind: 'visual',
        tool: 'visual.verifier.run',
        risk: 'medium',
        appliesTo: ['public/**/*.js', 'public/**/*.html', 'src/harness-sidecar/vlm/**/*.js'],
        tags: ['visual', 'vlm', 'ui'],
        toolInput: { targetUrl: 'http://localhost:3000' },
        rubric: { strictness: 'balanced' },
      }],
    }));

    const registry = await loadVerifierRegistry({ workspaceRoot });
    const verifier = registry.byName['visual-ui'];

    assert.equal(verifier.command, null);
    assert.equal(verifier.tool, 'visual.verifier.run');
    assert.deepEqual(verifier.toolInput, { targetUrl: 'http://localhost:3000' });
    assert.deepEqual(verifier.rubric, { strictness: 'balanced' });
    assert.deepEqual(verifier.tags, ['visual', 'vlm', 'ui']);
  });
});

test('verifier registry rejects unsafe or ambiguous tool verifier records', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(path.join(harnessDir, 'verifiers.json'), JSON.stringify({
      verifiers: [{
        name: 'unsafe-tool',
        tool: 'visual verifier/run',
      }],
    }));

    await assert.rejects(
      () => loadVerifierRegistry({ workspaceRoot }),
      /invalid tool/i,
    );

    await writeFile(path.join(harnessDir, 'verifiers.json'), JSON.stringify({
      verifiers: [{
        name: 'ambiguous',
        command: 'npm test',
        tool: 'visual.verifier.run',
      }],
    }));

    await assert.rejects(
      () => loadVerifierRegistry({ workspaceRoot }),
      /exactly one/i,
    );
  });
});

test('verifier runner executes command and tool verifiers and normalizes tool results', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const events = [];
    const toolCalls = [];
    const toolRegistry = {
      async execute(name, input) {
        toolCalls.push({ name, input });
        return {
          name: 'visual.verifier',
          passed: true,
          score: 0.88,
          artifacts: [{ type: 'screenshot', path: 'artifacts/after.png' }],
          imageDataUrl: 'data:image/png;base64,should-not-be-emitted',
        };
      },
    };

    const results = await runVerifiers({
      workspaceRoot,
      taskId: 'task_visual_tool',
      task: { task: 'Check public layout' },
      defaultToolInput: { workspaceRoot },
      toolRegistry,
      verifiers: [
        {
          name: 'node-ok',
          command: `${nodeCommand} -e "console.log('verified')"`,
          timeoutMs: 2000,
        },
        {
          name: 'visual-ui',
          kind: 'visual',
          command: null,
          tool: 'visual.verifier.run',
          toolInput: { targetUrl: 'http://localhost:3000' },
          rubric: { strictness: 'balanced' },
        },
      ],
      emitEvent: (event) => events.push(event),
    });

    assert.equal(results.length, 2);
    assert.equal(results[0].passed, true);
    assert.equal(results[1].name, 'visual-ui');
    assert.equal(results[1].tool, 'visual.verifier.run');
    assert.equal(results[1].passed, true);
    assert.equal(results[1].score, 0.88);
    assert.equal(typeof results[1].durationMs, 'number');
    assert.deepEqual(results[1].artifacts, [{ type: 'screenshot', path: 'artifacts/after.png' }]);
    assert.deepEqual(toolCalls, [{
      name: 'visual.verifier.run',
      input: {
        workspaceRoot,
        targetUrl: 'http://localhost:3000',
        taskId: 'task_visual_tool',
        goal: 'Check public layout',
        strictness: 'balanced',
      },
    }]);
    assert.equal(JSON.stringify(events).includes('should-not-be-emitted'), false);
  });
});

test('verifier registry rejects unsafe verifier cwd values', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(path.join(harnessDir, 'verifiers.json'), JSON.stringify({
      verifiers: [{
        name: 'unsafe',
        command: 'npm test',
        cwd: '..',
      }],
    }));

    await assert.rejects(
      () => loadVerifierRegistry({ workspaceRoot }),
      /outside workspace/i,
    );
  });
});
