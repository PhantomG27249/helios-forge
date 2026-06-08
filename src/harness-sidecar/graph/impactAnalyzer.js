const DEFAULT_VERIFIER_HINTS = [
  {
    name: 'unit',
    command: 'npm test',
    reason: 'js_impact_detected',
  },
  {
    name: 'focused_impacted_tests',
    command: 'npm test -- tests/harness-code-impact-graph.test.js',
    reason: 'code_impact_graph_changed',
  },
];

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniquePush(map, key, value) {
  if (!map.has(key)) {
    map.set(key, value);
  }
}

function reverseImportMap(importGraph) {
  const reverse = new Map();
  for (const edge of importGraph?.dependencyEdges || []) {
    const importers = reverse.get(edge.to) || [];
    importers.push(edge.from);
    reverse.set(edge.to, importers);
  }
  return reverse;
}

function impactedFilesFromImports(changedFiles, importGraph) {
  const reverse = reverseImportMap(importGraph);
  const impacted = new Map();
  const queue = [...changedFiles];

  for (const changedFile of changedFiles) {
    uniquePush(impacted, changedFile, {
      path: changedFile,
      reason: 'changed_file',
      distance: 0,
    });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const currentDistance = impacted.get(current)?.distance || 0;
    for (const importer of reverse.get(current) || []) {
      if (!impacted.has(importer)) {
        impacted.set(importer, {
          path: importer,
          reason: 'import_graph_impacted_by_change',
          via: current,
          distance: currentDistance + 1,
        });
        queue.push(importer);
      }
    }
  }

  return [...impacted.values()].sort((left, right) => (
    left.distance - right.distance
    || left.path.localeCompare(right.path)
  ));
}

function changedExportNames(changedFiles, importGraph) {
  const names = new Set();
  for (const changedFile of changedFiles) {
    for (const exported of importGraph?.exportsByFile?.get(changedFile) || []) {
      names.add(exported.name);
    }
  }
  return names;
}

function impactedSymbolsFromCalls({ changedFiles, impactedFilePaths, changedNames, callGraph }) {
  const symbols = new Map();

  for (const declaration of callGraph?.functions || []) {
    if (changedFiles.includes(declaration.filePath)) {
      uniquePush(symbols, declaration.symbolId, {
        filePath: declaration.filePath,
        name: declaration.name,
        symbolId: declaration.symbolId,
        reason: 'changed_file_defines_symbol',
        heuristic: true,
      });
    }
  }

  for (const edge of callGraph?.callEdges || []) {
    if (
      changedNames.has(edge.callName)
      && impactedFilePaths.has(edge.fromFile)
      && !changedFiles.includes(edge.fromFile)
    ) {
      uniquePush(symbols, edge.fromSymbol, {
        filePath: edge.fromFile,
        name: edge.fromSymbol.split(':').at(-1),
        symbolId: edge.fromSymbol,
        reason: 'call_graph_references_changed_symbol',
        via: edge.toSymbol,
        heuristic: true,
      });
    }
  }

  return [...symbols.values()].sort((left, right) => (
    left.filePath.localeCompare(right.filePath)
    || left.name.localeCompare(right.name)
  ));
}

export function analyzeCodeImpact({
  changedFiles = [],
  importGraph,
  callGraph,
  taskId = 'impact',
  verifierHints = DEFAULT_VERIFIER_HINTS,
} = {}) {
  const normalizedChangedFiles = [...new Set(changedFiles.map(normalizePath).filter(Boolean))];
  const impactedFiles = impactedFilesFromImports(normalizedChangedFiles, importGraph);
  const impactedFilePaths = new Set(impactedFiles.map((file) => file.path));
  const changedNames = changedExportNames(normalizedChangedFiles, importGraph);
  const impactedSymbols = impactedSymbolsFromCalls({
    changedFiles: normalizedChangedFiles,
    impactedFilePaths,
    changedNames,
    callGraph,
  });

  return {
    taskId,
    changedFiles: normalizedChangedFiles,
    impactedFiles,
    impactedSymbols,
    verifierHints: verifierHints.map((hint) => ({ ...hint })),
    reasons: [...new Set(impactedFiles.map((file) => file.reason))],
  };
}

