import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readImageArtifact } from '../src/harness-sidecar/vlm/imageIO.js';
import { runVisualModelObservation } from '../src/harness-sidecar/vlm/visualModelRunner.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

async function makeWorkspaceImage({ filename = 'panel.png', bytes = PNG_1X1 } = {}) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'hf-vlm-workspace-'));
  const artifactRoot = path.join(workspaceRoot, '.harness', 'traces', 'task_vlm', 'artifacts');
  const imagePath = path.join(artifactRoot, filename);
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(imagePath, bytes);
  return { workspaceRoot, artifactRoot, imagePath };
}

test('image IO reads safe workspace image artifacts as base64 data URLs with metadata', async () => {
  const { workspaceRoot, artifactRoot, imagePath } = await makeWorkspaceImage();

  const image = await readImageArtifact({
    imagePath,
    workspaceRoot,
    artifactRoots: [artifactRoot],
    maxBytes: 1024,
  });

  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.base64, PNG_1X1.toString('base64'));
  assert.equal(image.dataUrl, `data:image/png;base64,${PNG_1X1.toString('base64')}`);
  assert.equal(image.metadata.sizeBytes, PNG_1X1.length);
  assert.equal(image.metadata.filename, 'panel.png');
  assert.equal(image.metadata.extension, '.png');
  assert.equal(image.metadata.relativePath, path.join('.harness', 'traces', 'task_vlm', 'artifacts', 'panel.png'));
});

test('image IO detects jpeg webp and gif MIME types from file signatures', async () => {
  const webpBytes = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  const gifBytes = Buffer.from('GIF89a');

  for (const [filename, bytes, mimeType] of [
    ['photo.bin', JPEG_BYTES, 'image/jpeg'],
    ['frame.bin', webpBytes, 'image/webp'],
    ['anim.bin', gifBytes, 'image/gif'],
  ]) {
    const { workspaceRoot, artifactRoot, imagePath } = await makeWorkspaceImage({ filename, bytes });
    const image = await readImageArtifact({ imagePath, workspaceRoot, artifactRoots: [artifactRoot] });
    assert.equal(image.mimeType, mimeType);
  }
});

test('image IO rejects paths outside allowed workspace and artifact roots', async () => {
  const { workspaceRoot, artifactRoot } = await makeWorkspaceImage();
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'hf-vlm-outside-'));
  const outsidePath = path.join(outsideRoot, 'outside.png');
  await writeFile(outsidePath, PNG_1X1);

  await assert.rejects(
    readImageArtifact({
      imagePath: outsidePath,
      workspaceRoot,
      artifactRoots: [artifactRoot],
    }),
    /outside allowed roots/,
  );
});

test('image IO rejects images over the configured byte budget', async () => {
  const { workspaceRoot, artifactRoot, imagePath } = await makeWorkspaceImage();

  await assert.rejects(
    readImageArtifact({
      imagePath,
      workspaceRoot,
      artifactRoots: [artifactRoot],
      maxBytes: PNG_1X1.length - 1,
    }),
    /exceeds image byte budget/,
  );
});

test('image IO rejects files whose bytes are not a supported image signature', async () => {
  const { workspaceRoot, artifactRoot, imagePath } = await makeWorkspaceImage({
    filename: 'not-image.png',
    bytes: Buffer.from('plain text wearing an image extension'),
  });

  await assert.rejects(
    readImageArtifact({
      imagePath,
      workspaceRoot,
      artifactRoots: [artifactRoot],
    }),
    /unsupported image mime type/i,
  );
});

test('image IO rejects allowed-root symlinks that resolve outside allowed roots', async (t) => {
  const { workspaceRoot, artifactRoot } = await makeWorkspaceImage();
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'hf-vlm-outside-'));
  const outsidePath = path.join(outsideRoot, 'outside.png');
  const linkedPath = path.join(artifactRoot, 'linked.png');
  await writeFile(outsidePath, PNG_1X1);

  try {
    await symlink(outsidePath, linkedPath, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOTSUP') {
      t.skip(`symlink creation unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    readImageArtifact({
      imagePath: linkedPath,
      workspaceRoot,
      artifactRoots: [artifactRoot],
    }),
    /outside allowed roots/i,
  );
});

test('visual model runner sends data URL vision inputs and normalizes structured observations', async () => {
  const { workspaceRoot, artifactRoot, imagePath } = await makeWorkspaceImage();
  const calls = [];

  const result = await runVisualModelObservation({
    taskId: 'task_vlm_prod',
    prompt: 'Inspect the chart for unreadable labels.',
    imagePaths: [imagePath],
    workspaceRoot,
    artifactRoots: [artifactRoot],
    profileName: 'qwen36_vlm_fast',
    provider: async (input) => {
      calls.push(input);
      return {
        text: JSON.stringify({
          observations: [
            { text: 'The title is readable.', confidence: 0.92 },
            'Legend contrast is low.',
          ],
          ocrText: 'Revenue by quarter',
          risks: ['low_contrast_legend'],
          score: 0.74,
          artifacts: [{ path: imagePath, type: 'image/png' }],
        }),
        usage: { inputTokens: 21, outputTokens: 13 },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].structuredOutput, true);
  assert.equal(calls[0].visionInputs.length, 1);
  assert.equal(calls[0].visionInputs[0].mimeType, 'image/png');
  assert.equal(calls[0].visionInputs[0].dataUrl, `data:image/png;base64,${PNG_1X1.toString('base64')}`);
  assert.equal(calls[0].messages[0].content.some((part) => part.type === 'image_url' && part.image_url.url.startsWith('data:image/png;base64,')), true);
  assert.equal(result.observations.length, 2);
  assert.equal(result.observations[0].id, 'obs_1');
  assert.equal(result.observations[1].text, 'Legend contrast is low.');
  assert.equal(result.ocrText, 'Revenue by quarter');
  assert.deepEqual(result.risks, [{ description: 'low_contrast_legend' }]);
  assert.equal(result.score, 0.74);
  assert.equal(result.artifacts[0].path, imagePath);
  assert.equal(result.usage.totalTokens, 34);
});

test('visual model runner can call an injected model gateway object', async () => {
  const { workspaceRoot, artifactRoot, imagePath } = await makeWorkspaceImage();
  const calls = [];

  const result = await runVisualModelObservation({
    taskId: 'task_gateway',
    prompt: 'Inspect.',
    imagePaths: [imagePath],
    workspaceRoot,
    artifactRoots: [artifactRoot],
    modelGateway: {
      call: async (input) => {
        calls.push(input);
        return {
          structured: {
            observations: [{ text: 'No visual regression found.' }],
            risks: [],
            score: 1,
            artifacts: [],
          },
          usage: { inputTokens: 8, outputTokens: 6, totalTokens: 14 },
        };
      },
    },
  });

  assert.equal(calls[0].purpose, 'vlm_observation');
  assert.equal(calls[0].profileName, 'qwen36_vlm_fast');
  assert.equal(result.observations[0].text, 'No visual regression found.');
});

test('visual model runner applies multimodal budget policy before model gateway calls', async () => {
  const { workspaceRoot, artifactRoot, imagePath } = await makeWorkspaceImage();
  const calls = [];

  const result = await runVisualModelObservation({
    taskId: 'task_gateway_budget',
    prompt: 'Inspect with exhausted vision budget.',
    imagePaths: [imagePath],
    workspaceRoot,
    artifactRoots: [artifactRoot],
    budget: { remainingVisionTokens: 0 },
    modelGateway: {
      call: async (input) => {
        calls.push(input);
        return {
          structured: {
            observations: [{ text: 'Fell back to text-only budget.' }],
            risks: [],
            score: 0.5,
            artifacts: [],
          },
        };
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].visionInputs.length, 0);
  assert.equal(calls[0].messages[0].content.some((part) => part.type === 'image_url'), false);
  assert.equal(result.observations[0].text, 'Fell back to text-only budget.');
});

test('visual model runner accepts custom VLM profiles supplied by gateway overrides', async () => {
  const { workspaceRoot, artifactRoot, imagePath } = await makeWorkspaceImage();
  const calls = [];

  const result = await runVisualModelObservation({
    taskId: 'task_custom_gateway_profile',
    prompt: 'Inspect.',
    imagePaths: [imagePath],
    workspaceRoot,
    artifactRoots: [artifactRoot],
    profileName: 'workspace_qwen_vlm',
    modelGateway: {
      profileOverrides: {
        workspace_qwen_vlm: {
          model: 'Qwen/Qwen3.6-27B',
          baseUrl: 'http://qwen.test/v1',
          supportsVision: true,
        },
      },
      call: async (input) => {
        calls.push(input);
        return {
          structured: {
            observations: [{ text: 'Custom profile handled the image.' }],
            risks: [],
            score: 0.9,
            artifacts: [],
          },
        };
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].profileName, 'workspace_qwen_vlm');
  assert.equal(calls[0].visionInputs.length, 1);
  assert.equal(result.model.profileName, 'workspace_qwen_vlm');
  assert.equal(result.observations[0].text, 'Custom profile handled the image.');
});

test('visual model runner rejects malformed model output before returning observations', async () => {
  const { workspaceRoot, artifactRoot, imagePath } = await makeWorkspaceImage();

  await assert.rejects(
    runVisualModelObservation({
      taskId: 'task_bad_vlm',
      prompt: 'Inspect.',
      imagePaths: [imagePath],
      workspaceRoot,
      artifactRoots: [artifactRoot],
      provider: async () => ({
        text: JSON.stringify({ observations: 'not-an-array', score: 2 }),
      }),
    }),
    /Malformed VLM output/,
  );
});
