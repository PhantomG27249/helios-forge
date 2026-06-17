import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_VISION_MODELS, ensureModelImageInput } from '../src/pi/modelConfig.js';

test('default EBFT5 vision target uses the current deployed model id', () => {
  assert.deepEqual(DEFAULT_VISION_MODELS, [
    { provider: 'Zeus', modelId: 'selimaktas/ebft-5' },
  ]);
});

test('ensureModelImageInput enables images for a provider-scoped model', () => {
  const raw = JSON.stringify({
    providers: {
      Zeus: {
        models: [
          {
            id: 'selimaktas/ebft-5',
            contextWindow: 262144,
            input: ['text'],
            args: '--temp 0.6',
          },
        ],
      },
    },
  });

  const result = ensureModelImageInput(raw, [{ provider: 'Zeus', modelId: 'selimaktas/ebft-5' }]);
  const config = JSON.parse(result.rawJson);

  assert.equal(result.changed, true);
  assert.deepEqual(config.providers.Zeus.models[0].input, ['text', 'image']);
  assert.equal(config.providers.Zeus.models[0].args, '--temp 0.6');
});

test('ensureModelImageInput leaves already vision-capable config unchanged', () => {
  const raw = '{"providers":{"Zeus":{"models":[{"id":"selimaktas/ebft-5","input":["text","image"]}]}}}';

  const result = ensureModelImageInput(raw, [{ provider: 'Zeus', modelId: 'selimaktas/ebft-5' }]);

  assert.equal(result.changed, false);
  assert.equal(result.rawJson, JSON.stringify(JSON.parse(raw), null, 2));
});
