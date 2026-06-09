import {
  buildAdaptiveSearchContextForVerifier,
  normalizeAdaptiveSearchRewardForVerifier,
} from '../bes/adaptiveSearchAdapters.js';
import {
  recordAdaptiveSearchOutcome,
  selectAdaptiveSearchAction,
} from '../bes/adaptiveSearchScheduler.js';

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
  if (files.some((file) => file.startsWith('public/'))) return 'visual_surface_change';
  if (files.some((file) => file.startsWith('src/harness-sidecar/') || file === 'src/server.js')) {
    return 'sidecar_runtime_change';
  }
  if (files.some((file) => file.endsWith('.js'))) return 'default_js_change';
  return 'unknown_change';
}

function hasCodeChange(changedFiles) {
  return changedFiles.some((file) => normalizePath(file).endsWith('.js'));
}

function withReason(verifier, reason) {
  return { ...verifier, reason };
}

function policyMetadata(policy) {
  if (!policy) return undefined;
  return {
    policyId: policy.policyId,
    status: policy.status || 'shadow_only',
    mode: 'metadata_only',
  };
}

function pushUnique(selected, verifier, reason) {
  if (!verifier || selected.some((item) => item.name === verifier.name)) return;
  selected.push(withReason(verifier, reason));
}

function activeAdaptiveSearch(adaptiveSearch) {
  if (adaptiveSearch?.enabled !== true || !adaptiveSearch.scheduler) return null;
  return adaptiveSearch;
}

function attachAdaptiveSearchMetadata(selected, adaptiveSearch, action) {
  if (!action) return selected;
  const annotated = selected.map((verifier) => ({
    ...verifier,
    adaptiveSearch: {
      actionId: action.actionId,
      arm: action.arm,
      advisory: action.advisory,
    },
  }));
  const outcome = recordAdaptiveSearchOutcome({
    scheduler: adaptiveSearch.scheduler,
    actionId: action.actionId,
    reward: normalizeAdaptiveSearchRewardForVerifier({
      passed: annotated.length > 0,
      confidence: adaptiveSearch.context?.confidence ?? (annotated.length ? 0.62 : 0.25),
      budgetPressure: adaptiveSearch.budget?.pressure,
    }),
    evidence: {
      selectedCount: annotated.length,
      verifierNames: annotated.map((verifier) => verifier.name).join(','),
    },
  });
  annotated.adaptiveSearch = { action, outcome };
  return annotated;
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
  visualPolicy = null,
  adaptiveSearch,
} = {}) {
  if (!registry?.verifiers?.length) return [];
  const selected = [];
  const normalizedChangedFiles = changedFiles.map(normalizePath).filter(Boolean);
  const changeClass = classifyChange(normalizedChangedFiles);
  const activeSearch = activeAdaptiveSearch(adaptiveSearch);
  const adaptiveAction = activeSearch ? selectAdaptiveSearchAction({
    scheduler: activeSearch.scheduler,
    context: buildAdaptiveSearchContextForVerifier({
      task,
      taskId: activeSearch.context?.taskId || task?.taskId,
      changedFiles: normalizedChangedFiles,
      recentFailures,
      ...(activeSearch.context || {}),
      budget: {
        ...(activeSearch.context?.budget || {}),
        ...(activeSearch.budget || {}),
      },
    }),
  }) : null;

  for (const name of recentFailures) {
    pushUnique(selected, findByName(registry, name), 'recent_failure');
  }

  if (changeClass === 'vlm_change') {
    pushUnique(selected, findByKindOrTag(registry, ['visual', 'vlm']), 'vlm_change');
  }
  if (changeClass === 'visual_surface_change') {
    pushUnique(selected, findByKindOrTag(registry, ['visual', 'ui', 'vlm']), 'visual_surface_change');
    if (hasCodeChange(normalizedChangedFiles)) {
      pushUnique(selected, findByKindOrTag(registry, ['unit']), 'visual_surface_change');
    }
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

  const sliced = selected.slice(0, Math.max(1, maxVerifiers));
  const policyAnnotated = !visualPolicy ? sliced : sliced.map((verifier) => (
    verifier.kind === 'visual' || verifier.tags?.includes?.('visual') || verifier.tags?.includes?.('vlm')
      ? { ...verifier, policy: policyMetadata(visualPolicy) }
      : verifier
  ));
  return attachAdaptiveSearchMetadata(policyAnnotated, activeSearch, adaptiveAction);
}
