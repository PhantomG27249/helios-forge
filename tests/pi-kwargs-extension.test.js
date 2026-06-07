import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildModelArgsLookup,
  createModelArgsResolver,
  createProviderRequestPatch,
  parseZeusArgs,
} from '../src/pi/modelArgs.js';

test('parseZeusArgs preserves thinking kwargs even without temperature args', () => {
  const parsed = parseZeusArgs('--chat-template-kwargs \'{"enable_thinking":true}\'');

  assert.equal(parsed.chat_template_kwargs.enable_thinking, true);
  assert.equal(parsed.chat_template_kwargs.preserve_thinking, true);
});

test('parseZeusArgs handles chat template kwargs before later sampling args', () => {
  const parsed = parseZeusArgs('--chat-template-kwargs \'{"enable_thinking":false}\' --temp 0.2 --top-p 0.9');

  assert.equal(parsed.chat_template_kwargs.enable_thinking, false);
  assert.equal(parsed.chat_template_kwargs.preserve_thinking, false);
  assert.equal(parsed.temperature, 0.2);
  assert.equal(parsed.top_p, 0.9);
});

test('model args lookup tolerates UTF-8 BOM and provider scoped keys', () => {
  const lookup = buildModelArgsLookup('\uFEFF{"providers":{"Zeus":{"models":[{"id":"example/ebft-model","args":"--temp 0.6"}]}}}');

  assert.equal(lookup['Zeus/example/ebft-model'].modelId, 'example/ebft-model');
  assert.equal(lookup['example/ebft-model'].providerName, 'Zeus');
});

test('model args resolver reloads when models file mtime changes', () => {
  let raw = '{"providers":{"Zeus":{"models":[{"id":"m","args":"--temp 0.1"}]}}}';
  let mtimeMs = 1;
  const resolver = createModelArgsResolver({
    readFile: () => raw,
    statFile: () => ({ mtimeMs }),
    modelsPath: 'models.json',
  });

  assert.equal(parseZeusArgs(resolver()['m'].args).temperature, 0.1);

  raw = '{"providers":{"Zeus":{"models":[{"id":"m","args":"--temp 0.7"}]}}}';
  mtimeMs = 2;
  assert.equal(parseZeusArgs(resolver()['m'].args).temperature, 0.7);
});

test('provider request patch matches provider and model aliases', () => {
  const lookup = buildModelArgsLookup('{"providers":{"Zeus":{"models":[{"id":"example/ebft-model","args":"--chat-template-kwargs \'{\\"enable_thinking\\":false}\'"}]}}}');
  const patched = createProviderRequestPatch({
    payload: { model: 'example/ebft-model', messages: [] },
    modelId: 'example/ebft-model',
    providerName: 'Zeus',
    providerKey: 'dummy',
    lookup,
  });

  assert.equal(patched.chat_template_kwargs.enable_thinking, false);
  assert.equal(patched.chat_template_kwargs.preserve_thinking, false);
});
