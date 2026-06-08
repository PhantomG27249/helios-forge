import path from 'path';

const IMPORT_PATTERN = /\bimport\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_DECLARATION_PATTERN = /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_PATTERN = /\bexport\s*\{([^}]+)\}/g;
const EXPORT_DEFAULT_NAMED_PATTERN = /\bexport\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g;

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function groupedSourceFromIndex(index) {
  const grouped = new Map();
  for (const item of index?.items || []) {
    const filePath = normalizePath(item.path);
    if (!filePath) continue;
    const existing = grouped.get(filePath) || [];
    existing.push(item.snippet || item.content || '');
    grouped.set(filePath, existing);
  }
  return [...grouped.entries()]
    .map(([filePath, snippets]) => ({
      path: filePath,
      source: snippets.join('\n'),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function dedupeByKey(items, keyFn) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function extractExportNames(source) {
  const exports = [];

  for (const match of source.matchAll(EXPORT_DECLARATION_PATTERN)) {
    exports.push({ name: match[1], kind: 'named', heuristic: true });
  }

  for (const match of source.matchAll(EXPORT_DEFAULT_NAMED_PATTERN)) {
    exports.push({ name: match[1], kind: 'default', heuristic: true });
  }

  for (const match of source.matchAll(EXPORT_LIST_PATTERN)) {
    for (const segment of match[1].split(',')) {
      const [localName, exportedName] = segment.trim().split(/\s+as\s+/);
      const name = (exportedName || localName || '').trim();
      if (name) {
        exports.push({ name, kind: 'named', heuristic: true });
      }
    }
  }

  return dedupeByKey(exports, (item) => `${item.kind}:${item.name}`)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function extractImportSources(source) {
  const imports = [];

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    imports.push({ source: match[1], kind: 'static', heuristic: true });
  }

  for (const match of source.matchAll(DYNAMIC_IMPORT_PATTERN)) {
    imports.push({ source: match[1], kind: 'dynamic', heuristic: true });
  }

  return dedupeByKey(imports, (item) => `${item.kind}:${item.source}`);
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function resolutionCandidates(specifier, fromFilePath) {
  const base = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(fromFilePath), specifier)));
  const extension = path.posix.extname(base);
  if (extension) {
    return [base];
  }
  return [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.json`,
    path.posix.join(base, 'index.js'),
    path.posix.join(base, 'index.mjs'),
    path.posix.join(base, 'index.ts'),
  ];
}

export function resolveImportSpecifier({ source, fromFilePath, knownFiles }) {
  if (!isRelativeSpecifier(source)) {
    return null;
  }

  for (const candidate of resolutionCandidates(source, fromFilePath)) {
    if (knownFiles.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function extractImportGraphFromIndex(index, { taskId = 'index' } = {}) {
  const files = groupedSourceFromIndex(index);
  const knownFiles = new Set(files.map((file) => file.path));
  const importsByFile = new Map();
  const exportsByFile = new Map();
  const dependencyEdges = [];
  const unresolvedImports = [];
  const externalImports = [];

  for (const file of files) {
    const imports = extractImportSources(file.source).map((item) => {
      const resolvedPath = resolveImportSpecifier({
        source: item.source,
        fromFilePath: file.path,
        knownFiles,
      });
      return {
        ...item,
        filePath: file.path,
        resolvedPath,
      };
    });
    const exports = extractExportNames(file.source).map((item) => ({
      ...item,
      filePath: file.path,
    }));

    importsByFile.set(file.path, imports);
    exportsByFile.set(file.path, exports);

    for (const imported of imports) {
      if (imported.resolvedPath) {
        dependencyEdges.push({
          from: file.path,
          to: imported.resolvedPath,
          type: 'imports',
          source: imported.source,
          reason: 'import_graph_dependency',
          heuristic: true,
          taskId,
        });
      } else if (isRelativeSpecifier(imported.source)) {
        unresolvedImports.push({
          filePath: file.path,
          source: imported.source,
          reason: 'relative_import_unresolved',
          heuristic: true,
          taskId,
        });
      } else {
        externalImports.push({
          filePath: file.path,
          source: imported.source,
          reason: 'external_import',
          heuristic: true,
          taskId,
        });
      }
    }
  }

  dependencyEdges.sort((left, right) => (
    left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to)
    || left.source.localeCompare(right.source)
  ));

  return {
    taskId,
    files,
    importsByFile,
    exportsByFile,
    dependencyEdges,
    unresolvedImports,
    externalImports,
  };
}

