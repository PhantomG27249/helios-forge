import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildModelArgsLookup,
  createModelArgsResolver,
  createProviderRequestPatch,
  parseZeusArgsWithDiagnostics,
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

test('parseZeusArgs reports reasoning parser as unsupported request metadata', () => {
  const result = parseZeusArgsWithDiagnostics('--reasoning-parser qwen3 --temp 0.2');

  assert.equal(result.params.temperature, 0.2);
  assert.deepEqual(result.diagnostics, [
    {
      flag: '--reasoning-parser',
      value: 'qwen3',
      reason: 'reasoning parser is a vLLM server startup flag and cannot be forwarded per request',
    },
  ]);
});

test('parseZeusArgs preserves explicit ebft-5 thinking-disabled profile', () => {
  const parsed = parseZeusArgs('--reasoning-parser qwen3 --chat-template-kwargs \'{"enable_thinking":false}\' --temp 0.15 --top-p 0.95');

  assert.equal(parsed.chat_template_kwargs.enable_thinking, false);
  assert.equal(parsed.chat_template_kwargs.preserve_thinking, false);
  assert.equal(parsed.temperature, 0.15);
  assert.equal(parsed.top_p, 0.95);
});

test('parseZeusArgs preserves thinking-enabled profile', () => {
  const parsed = parseZeusArgs('--reasoning-parser qwen3 --chat-template-kwargs \'{"enable_thinking":true}\' --temp 0.6 --top-k 40');

  assert.equal(parsed.chat_template_kwargs.enable_thinking, true);
  assert.equal(parsed.chat_template_kwargs.preserve_thinking, true);
  assert.equal(parsed.temperature, 0.6);
  assert.equal(parsed.top_k, 40);
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

test('provider request patch reports unsupported reasoning parser without forwarding it', () => {
  const lookup = buildModelArgsLookup('{"providers":{"Zeus":{"models":[{"id":"example/ebft-model","args":"--reasoning-parser qwen3 --temp 0.3"}]}}}');
  const diagnostics = [];
  const patched = createProviderRequestPatch({
    payload: { model: 'example/ebft-model', messages: [] },
    modelId: 'example/ebft-model',
    providerName: 'Zeus',
    providerKey: 'dummy',
    lookup,
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  assert.equal(patched.temperature, 0.3);
  assert.equal(patched.reasoning_parser, undefined);
  assert.deepEqual(diagnostics, [
    {
      providerName: 'Zeus',
      modelId: 'example/ebft-model',
      flag: '--reasoning-parser',
      value: 'qwen3',
      reason: 'reasoning parser is a vLLM server startup flag and cannot be forwarded per request',
    },
  ]);
});
