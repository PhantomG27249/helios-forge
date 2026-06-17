import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePromptImage, normalizePromptImages } from '../src/pi/normalizePromptImages.js';

test('normalizePromptImage converts structured attachments to pi image blocks', () => {
  assert.deepEqual(
    normalizePromptImage({ mimeType: 'image/png', data: 'abc123' }),
    { type: 'image', mimeType: 'image/png', data: 'abc123' },
  );
});

test('normalizePromptImage converts data URLs to raw base64 image blocks', () => {
  const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ';
  assert.deepEqual(
    normalizePromptImage(dataUrl),
    { type: 'image', mimeType: 'image/jpeg', data: '/9j/4AAQ' },
  );
});

test('normalizePromptImage ignores ui type field when mimeType is present', () => {
  assert.deepEqual(
    normalizePromptImage({ type: 'image', mimeType: 'image/png', data: 'abc123' }),
    { type: 'image', mimeType: 'image/png', data: 'abc123' },
  );
});

test('normalizePromptImages rejects oversized attachments', () => {
  const huge = 'a'.repeat(6 * 1024 * 1024);
  assert.throws(
    () => normalizePromptImages([{ mimeType: 'image/png', data: huge }], { maxImageBytes: 1024 }),
    /exceeds 1024 byte limit/,
  );
});

test('normalizePromptImages rejects invalid base64 characters', () => {
  assert.throws(
    () => normalizePromptImages([{ mimeType: 'image/png', data: 'not valid base64!!!' }]),
    /invalid base64 characters/,
  );
});
