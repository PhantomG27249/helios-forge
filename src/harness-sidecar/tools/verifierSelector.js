function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern) {
  const normalized = normalizePath(pattern);
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === '*' && next === '*') {
      const after = normalized[index + 2];
      if (after === '/') {
        source += '(?:.*\\/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesPattern(filePath, pattern) {
  return globToRegex(pattern).test(normalizePath(filePath));
}

function verifierMatches(verifier, changedFiles) {
  const patterns = verifier.appliesTo?.length ? verifier.appliesTo : ['**/*'];
  return changedFiles.some((filePath) => patterns.some((pattern) => matchesPattern(filePath, pattern)));
}

function classifyChange(changedFiles) {
  const files = changedFiles.map(normalizePath);
  if (files.some((file) => file.startsWith('src/harness-sidecar/vlm/'))) return 'vlm_change';
  if (files.some((file) => file.startsWith('src/harness-sidecar/') || file === 'src/server.js')) {
    return 'sidecar_runtime_change';
  }
  if (files.some((file) => file.endsWith('.js'))) return 'default_js_change';
  return 'unknown_change';
}

function withReason(verifier, reason) {
  return { ...verifier, reason };
}

function pushUnique(selected, verifier, reason) {
  if (!verifier || selected.some((item) => item.name === verifier.name)) return;
  selected.push(withReason(verifier, reason));
}

function findByName(registry, name) {
  return registry.byName?.[name] || registry.verifiers?.find((verifier) => verifier.name === name);
}

function findByKindOrTag(registry, values) {
  return registry.verifiers?.find((verifier) => values.includes(verifier.kind)
    || verifier.tags?.some((tag) => values.includes(tag)));
}

export function selectVerifiersForTask({
  task,
  changedFiles = [],
  registry,
  recentFailures = [],
  maxVerifiers = 4,
} = {}) {
  if (!registry?.verifiers?.length) return [];
  const selected = [];
  const normalizedChangedFiles = changedFiles.map(normalizePath).filter(Boolean);
  const changeClass = classifyChange(normalizedChangedFiles);

  for (const name of recentFailures) {
    pushUnique(selected, findByName(registry, name), 'recent_failure');
  }

  if (changeClass === 'vlm_change') {
    pushUnique(selected, findByKindOrTag(registry, ['visual', 'vlm']), 'vlm_change');
  }
  if (changeClass === 'sidecar_runtime_change') {
    pushUnique(selected, findByKindOrTag(registry, ['integration', 'sidecar']), 'sidecar_runtime_change');
    pushUnique(selected, findByKindOrTag(registry, ['smoke']), 'sidecar_runtime_change');
  }
  if (changeClass === 'default_js_change') {
    pushUnique(selected, findByKindOrTag(registry, ['unit']), 'default_js_change');
  }

  for (const verifier of registry.verifiers) {
    if (!normalizedChangedFiles.length || !verifierMatches(verifier, normalizedChangedFiles)) continue;
    pushUnique(selected, verifier, changeClass);
  }

  if (!selected.length || changeClass === 'unknown_change') {
    pushUnique(selected, findByKindOrTag(registry, ['unit']), 'unknown_change');
    pushUnique(selected, findByKindOrTag(registry, ['smoke']), 'unknown_change');
  }

  if (task?.requiresSmoke) {
    pushUnique(selected, findByKindOrTag(registry, ['smoke']), 'task_requires_smoke');
  }

  return selected.slice(0, Math.max(1, maxVerifiers));
}
