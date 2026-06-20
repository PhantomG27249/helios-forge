import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncVendorAssets } from '../scripts/sync-vendor-assets.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('syncVendorAssets copies markdown and syntax assets into public/vendor', async () => {
  const result = await syncVendorAssets({ root: repoRoot });
  assert.equal(result.files.includes(path.join('public', 'vendor', 'marked.min.js')), true);

  for (const relativePath of [
    'public/vendor/marked.min.js',
    'public/vendor/highlight.min.js',
    'public/vendor/github-dark.min.css',
    'public/vendor/katex/katex.min.js',
    'public/vendor/katex/contrib/auto-render.min.js',
  ]) {
    await access(path.join(repoRoot, relativePath));
  }
});
