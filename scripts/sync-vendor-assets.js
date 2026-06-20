import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = path.join(repoRoot, 'public', 'vendor');

const copies = [
  {
    from: path.join(repoRoot, 'node_modules', 'marked', 'marked.min.js'),
    to: path.join(vendorRoot, 'marked.min.js'),
  },
  {
    from: path.join(repoRoot, 'node_modules', '@highlightjs', 'cdn-assets', 'highlight.min.js'),
    to: path.join(vendorRoot, 'highlight.min.js'),
  },
  {
    from: path.join(repoRoot, 'node_modules', '@highlightjs', 'cdn-assets', 'styles', 'github-dark.min.css'),
    to: path.join(vendorRoot, 'github-dark.min.css'),
  },
  {
    from: path.join(repoRoot, 'node_modules', 'katex', 'dist', 'katex.min.js'),
    to: path.join(vendorRoot, 'katex', 'katex.min.js'),
  },
  {
    from: path.join(repoRoot, 'node_modules', 'katex', 'dist', 'katex.min.css'),
    to: path.join(vendorRoot, 'katex', 'katex.min.css'),
  },
  {
    from: path.join(repoRoot, 'node_modules', 'katex', 'dist', 'contrib', 'auto-render.min.js'),
    to: path.join(vendorRoot, 'katex', 'contrib', 'auto-render.min.js'),
  },
  {
    from: path.join(repoRoot, 'node_modules', 'katex', 'dist', 'fonts'),
    to: path.join(vendorRoot, 'katex', 'fonts'),
  },
];

export async function syncVendorAssets({ root = repoRoot } = {}) {
  const targetRoot = path.join(root, 'public', 'vendor');
  await mkdir(targetRoot, { recursive: true });

  const resolvedCopies = copies.map((entry) => ({
    from: entry.from.replace(repoRoot, root),
    to: entry.to.replace(repoRoot, root),
  }));

  for (const { from, to } of resolvedCopies) {
    await mkdir(path.dirname(to), { recursive: true });
    await cp(from, to, { recursive: true, force: true });
  }

  return {
    vendorRoot: targetRoot,
    files: resolvedCopies.map((entry) => path.relative(root, entry.to)),
  };
}

const isDirectRun = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (isDirectRun) {
  syncVendorAssets()
    .then((result) => {
      console.log(`Synced ${result.files.length} vendor assets to ${result.vendorRoot}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
