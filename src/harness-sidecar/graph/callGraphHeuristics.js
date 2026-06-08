const FUNCTION_DECLARATION_PATTERN = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
const CALL_PATTERN = /\b([A-Za-z_$][\w$]*)\s*\(/g;

const IGNORED_CALL_NAMES = new Set([
  'catch',
  'for',
  'function',
  'if',
  'import',
  'return',
  'switch',
  'while',
]);

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

function findMatchingBrace(source, openBraceIndex) {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return source.length - 1;
}

function extractFunctionDeclarations(filePath, source) {
  const declarations = [];
  for (const match of source.matchAll(FUNCTION_DECLARATION_PATTERN)) {
    const openBraceIndex = match.index + match[0].length - 1;
    const endIndex = findMatchingBrace(source, openBraceIndex);
    declarations.push({
      filePath,
      name: match[1],
      symbolId: `${filePath}:${match[1]}`,
      startIndex: match.index,
      endIndex,
      body: source.slice(openBraceIndex + 1, endIndex),
      heuristic: true,
    });
  }
  return declarations;
}

function extractCallNames(body) {
  const calls = [];
  for (const match of body.matchAll(CALL_PATTERN)) {
    const name = match[1];
    if (!IGNORED_CALL_NAMES.has(name)) {
      calls.push(name);
    }
  }
  return [...new Set(calls)].sort((left, right) => left.localeCompare(right));
}

export function extractCallGraphFromIndex(index, { taskId = 'index' } = {}) {
  const files = groupedSourceFromIndex(index);
  const functions = files
    .flatMap((file) => extractFunctionDeclarations(file.path, file.source))
    .sort((left, right) => (
      left.filePath.localeCompare(right.filePath)
      || left.name.localeCompare(right.name)
    ));
  const definitionsByName = new Map();
  for (const declaration of functions) {
    const existing = definitionsByName.get(declaration.name) || [];
    existing.push(declaration);
    definitionsByName.set(declaration.name, existing);
  }

  const callEdges = [];
  for (const declaration of functions) {
    for (const callName of extractCallNames(declaration.body)) {
      for (const target of definitionsByName.get(callName) || []) {
        callEdges.push({
          fromFile: declaration.filePath,
          fromSymbol: declaration.symbolId,
          toFile: target.filePath,
          toSymbol: target.symbolId,
          callName,
          type: 'calls',
          reason: 'heuristic_call_reference',
          heuristic: true,
          taskId,
        });
      }
    }
  }

  callEdges.sort((left, right) => (
    left.fromSymbol.localeCompare(right.fromSymbol)
    || left.toSymbol.localeCompare(right.toSymbol)
  ));

  return {
    taskId,
    files,
    functions,
    callEdges,
  };
}

