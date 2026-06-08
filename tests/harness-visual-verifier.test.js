import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runVisualVerifier } from '../src/harness-sidecar/vlm/visualVerifier.js';
import { createVisualVerifierRubric } from '../src/harness-sidecar/vlm/visualVerifierRubric.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-visual-verifier-'));
  try {
    await testFn({ workspaceRoot });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('visual verifier captures artifacts and returns normalized vlmJudge evidence', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const events = [];
    const calls = [];
    const beforePath = path.join(workspaceRoot, 'before.png');
    const afterPath = path.join(workspaceRoot, 'after.png');
    await writeFile(beforePath, PNG_1X1);
    await writeFile(afterPath, PNG_1X1);

    const result = await runVisualVerifier({
      taskId: 'task_visual',
      workspaceRoot,
      goal: 'Verify the page still shows the pricing table.',
      expected: ['pricing table visible'],
      targetUrl: 'http://user:pass@127.0.0.1:3000/?token=private#frag',
      beforePath,
      afterPath,
      emitEvent: (event) => events.push(event),
      captureAdapter: {
        screenshot: async ({ outputPath, url }) => {
          calls.push({ type: 'screenshot', outputPath, url });
          await writeFile(outputPath, PNG_1X1);
          return { imagePath: outputPath, width: 320, height: 200 };
        },
        visualDiff: async ({ outputPath }) => {
          calls.push({ type: 'visualDiff', outputPath });
          await writeFile(outputPath, PNG_1X1);
          return { diffPath: outputPath, summary: 'No meaningful visual change.' };
        },
      },
      vlmJudge: async ({ rubric, artifacts, imageInputs }) => {
        calls.push({ type: 'judge', rubric, artifacts, imageInputs });
        return {
          score: 0.87,
          confidence: 0.82,
          findings: [],
          passed: true,
          model: { model: 'local-test-vlm' },
        };
      },
    });

    assert.equal(result.name, 'visual.verifier');
    assert.equal(result.passed, true);
    assert.equal(result.score, 0.87);
    assert.equal(result.confidence, 0.82);
    assert.deepEqual(result.findings, []);
    assert.equal(result.artifacts.length, 2);
    assert.equal(result.rubricVersion, 1);
    assert.deepEqual(result.model, { model: 'local-test-vlm' });
    assert.equal(calls.some((call) => call.type === 'screenshot'), true);
    assert.equal(calls.some((call) => call.type === 'visualDiff'), true);
    assert.equal(calls.some((call) => call.type === 'judge' && call.rubric.expected[0] === 'pricing table visible'), true);
    assert.equal(events.some((event) => event.type === 'visual_verifier.started'), true);
    assert.equal(events.some((event) => event.type === 'visual_verifier.artifacts_captured'), true);
    assert.equal(events.some((event) => event.type === 'visual_verifier.completed'), true);
    assert.equal(JSON.stringify(events).includes('data:image'), false);
    assert.equal(JSON.stringify(events).includes('private'), false);
    assert.equal(JSON.stringify(result.artifacts).includes('private'), false);
    assert.equal(result.artifacts[0].metadata.source.url, 'http://127.0.0.1:3000/');
  });
});

test('visual verifier fails when no visual artifact is available', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const events = [];
    const result = await runVisualVerifier({
      taskId: 'task_no_artifact',
      workspaceRoot,
      goal: 'Verify the app.',
      targetUrl: 'http://127.0.0.1:3000/',
      emitEvent: (event) => events.push(event),
      captureAdapter: {
        screenshot: async () => ({ status: 'unavailable', reason: 'browser_runtime_required' }),
      },
      vlmJudge: async () => {
        throw new Error('judge should not run');
      },
    });

    assert.equal(result.name, 'visual.verifier');
    assert.equal(result.passed, false);
    assert.equal(result.reason, 'visual_artifact_unavailable');
    assert.equal(result.artifacts.length, 0);
    assert.equal(events.some((event) => event.type === 'visual_verifier.failed' && event.reason === 'visual_artifact_unavailable'), true);
  });
});

test('visual verifier treats model passed as advisory and enforces thresholds', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await runVisualVerifier({
      taskId: 'task_visual_thresholds',
      workspaceRoot,
      goal: 'Verify the page is visually correct.',
      targetUrl: 'http://127.0.0.1:3000/',
      strictness: 'strict',
      captureAdapter: {
        screenshot: async ({ outputPath }) => {
          await writeFile(outputPath, PNG_1X1);
          return { imagePath: outputPath, width: 320, height: 200 };
        },
      },
      vlmJudge: async () => ({
        score: 0.2,
        confidence: 0.2,
        findings: [],
        passed: true,
        model: { model: 'prompt-injected-vlm' },
      }),
    });

    assert.equal(result.modelPassed, true);
    assert.equal(result.passed, false);
    assert.equal(result.score, 0.2);
    assert.equal(result.confidence, 0.2);
  });
});

test('visual verifier sends modelGateway metadata and safe image data URLs only in the model call', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const calls = [];
    const result = await runVisualVerifier({
      taskId: 'task_model_gateway',
      workspaceRoot,
      goal: 'Verify the preview has no layout regression.',
      targetUrl: 'http://127.0.0.1:3000/',
      captureAdapter: {
        screenshot: async ({ outputPath }) => {
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeFile(outputPath, PNG_1X1);
          return { imagePath: outputPath, width: 64, height: 64 };
        },
      },
      modelGateway: {
        call: async (input) => {
          calls.push(input);
          return {
            structured: {
              score: 0.8,
              confidence: 0.7,
              findings: [{ severity: 'low', message: 'Minor spacing difference.' }],
            },
            profile: { model: 'local-test-vlm' },
          };
        },
      },
    });

    assert.equal(result.passed, true);
    assert.equal(result.model.model, 'local-test-vlm');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].purpose, 'visual_verifier');
    assert.equal(calls[0].visionInputs[0].dataUrl.startsWith('data:image/png;base64,'), true);
    assert.equal(calls[0].artifacts[0].type, 'screenshot');
    assert.equal(JSON.stringify(calls[0].artifacts).includes('data:image'), false);
  });
});

test('visual verifier rubric exposes strictness thresholds', () => {
  assert.deepEqual(
    createVisualVerifierRubric({ goal: 'Strict visual check', strictness: 'strict' }),
    {
      rubricVersion: 1,
      strictness: 'strict',
      prompt: [
        'You are the Helios visual verifier.',
        'Goal: Strict visual check',
        'Artifact types: none',
        'Expected evidence: none',
        'Judge whether the supplied visual artifacts satisfy the goal. Return one JSON object with score, confidence, findings, and optional passed.',
      ].join('\n'),
      expected: [],
      passThreshold: 0.9,
      confidenceThreshold: 0.75,
    },
  );
});
