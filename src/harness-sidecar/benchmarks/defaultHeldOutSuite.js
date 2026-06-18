import path from 'node:path';

import { detectWorkplaceTestRunner } from './workplaceSuiteDetector.js';

export { detectWorkplaceTestRunner } from './workplaceSuiteDetector.js';

function resolveWorkplaceMetadata(options = {}) {
  if (options.workplaceMetadata && typeof options.workplaceMetadata === 'object') {
    return options.workplaceMetadata;
  }
  if (options.harnessConfig && typeof options.harnessConfig === 'object') {
    return options.harnessConfig;
  }
  return {};
}

export function mergeHeldOutSuiteWithDefaults(existingSuite = {}, defaultSuite = {}) {
  const existingCases = Array.isArray(existingSuite.cases) ? existingSuite.cases : [];
  const defaultCases = Array.isArray(defaultSuite.cases) ? defaultSuite.cases : [];
  const existingById = new Map(existingCases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
  const mergedCases = [...existingCases];

  for (const defaultCase of defaultCases) {
    if (!existingById.has(defaultCase.id)) {
      mergedCases.push(defaultCase);
    }
  }

  return {
    ...defaultSuite,
    ...existingSuite,
    cases: mergedCases,
    advisory: existingSuite.advisory ?? defaultSuite.advisory ?? null,
  };
}

export async function buildDefaultHeldOutSuite({
  workspaceRoot,
  workplaceMetadata,
  harnessConfig,
  existingSuite = null,
  force = false,
} = {}) {
  const root = path.resolve(workspaceRoot);
  const metadata = resolveWorkplaceMetadata({ workplaceMetadata, harnessConfig });
  const primary = await detectWorkplaceTestRunner(root, metadata);

  const cases = [
    {
      id: 'workplace-primary-test',
      domain: 'code',
      description: 'Run the workplace primary test command.',
      command: {
        executable: primary.executable,
        args: [...primary.args],
      },
    },
    {
      id: 'workplace-exit-sanity',
      domain: 'safety',
      description: 'Verify command execution returns real process exit codes.',
      command: {
        executable: 'node',
        args: ['-e', 'process.exit(0)'],
      },
    },
  ];

  if (primary.type === 'pytest' || primary.type === 'pyproject-script') {
    cases.push({
      id: 'workplace-node-sanity',
      domain: 'code',
      description: 'Node runtime availability check.',
      command: {
        executable: 'node',
        args: ['-e', 'process.exit(0)'],
      },
    });
  } else {
    cases.push({
      id: 'workplace-inline-pass',
      domain: 'code',
      description: 'Inline node assertion smoke.',
      command: {
        executable: 'node',
        args: ['-e', 'if (1 + 1 !== 2) process.exit(1); process.exit(0);'],
      },
    });
  }

  const defaultSuite = {
    schemaVersion: 1,
    id: 'workplace-smoke',
    description: 'Default held-out smoke suite scaffolded for workplace evolution replay.',
    domains: ['code', 'safety'],
    metricWeights: {
      quality: 1,
      reliability: 0.5,
      safety: 0.5,
    },
    cases,
    advisory: primary.advisory ?? null,
  };

  if (force || !existingSuite) {
    return defaultSuite;
  }

  return mergeHeldOutSuiteWithDefaults(existingSuite, defaultSuite);
}
