import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  setEnableThinkingInArgs,
  setModelEnableThinking,
} from '../src/harness/piModelsService.js';

test('setEnableThinkingInArgs flips enable_thinking in existing model args', () => {
  const args = '--chat-template-kwargs \'{"enable_thinking":false}\'';
  const next = setEnableThinkingInArgs(args, true);
  assert.match(next, /enable_thinking":true/);
});

test('setModelEnableThinking updates models.json for a provider model', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'helios-pi-models-'));
  const modelsPath = path.join(dir, 'models.json');
  await writeFile(modelsPath, JSON.stringify({
    providers: {
      Zeus: {
        models: [{
          id: 'selimaktas/ebft-5',
          args: '--chat-template-kwargs \'{"enable_thinking":false}\'',
        }],
      },
    },
  }, null, 2));

  const result = await setModelEnableThinking({
    provider: 'Zeus',
    modelId: 'selimaktas/ebft-5',
    enabled: true,
    modelsPath,
  });

  assert.equal(result.enableThinking, true);
  const saved = JSON.parse(await readFile(modelsPath, 'utf8'));
  assert.match(saved.providers.Zeus.models[0].args, /enable_thinking":true/);
});
