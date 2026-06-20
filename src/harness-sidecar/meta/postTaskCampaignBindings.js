import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CAMPAIGN_MAX_CYCLES = 3;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function resolveMaxCycles(harnessConfig = {}) {
  const configured = harnessConfig.evolution?.campaignMaxCycles;
  const number = Number(configured ?? DEFAULT_CAMPAIGN_MAX_CYCLES);
  if (!Number.isInteger(number) || number < 1) {
    return DEFAULT_CAMPAIGN_MAX_CYCLES;
  }
  return number;
}

function replayReportId(report = {}) {
  return report.reportId || report.replayId || report.id || null;
}

function replayMetricsFromReports(replayReports = []) {
  const reports = asArray(replayReports).filter(Boolean);
  const latest = reports.length ? reports[reports.length - 1] : null;
  if (!latest) return null;

  const quality = Number(latest.aggregateScore ?? latest.metrics?.quality);
  return {
    quality: Number.isFinite(quality) ? quality : null,
    safety: Number(latest.metrics?.safety),
    cost: Number(latest.metrics?.cost),
    latency: Number(latest.metrics?.latency),
    report: latest,
  };
}

function proposerSourceFilesFromInputs(evolutionInputs = {}) {
  const candidate = normalizeObject(evolutionInputs.metaCandidate?.candidate);
  if (candidate.sourceFiles && typeof candidate.sourceFiles === 'object' && !Array.isArray(candidate.sourceFiles)) {
    return candidate.sourceFiles;
  }

  const changes = candidate.patch?.changes || candidate.proposal?.changes;
  if (!Array.isArray(changes)) return {};

  const sourceFiles = {};
  for (const change of changes) {
    if (!change?.file || change.value === undefined) continue;
    sourceFiles[change.file] = typeof change.value === 'string'
      ? change.value
      : JSON.stringify(change.value);
  }
  return sourceFiles;
}

function proposerConfigFromInputs({ task = {}, evolutionInputs = {}, replayReports = [] } = {}) {
  const reports = asArray(replayReports).filter(Boolean);
  const config = {
    source: 'post_task_recursive_evolution',
    taskId: task.taskId || null,
    replayReportIds: reports.map(replayReportId).filter(Boolean),
  };

  const metaCandidate = normalizeObject(evolutionInputs.metaCandidate);
  if (metaCandidate.candidateId) {
    config.metaCandidateId = metaCandidate.candidateId;
  }
  if (evolutionInputs.swarmChampion?.attemptId) {
    config.swarmChampionAttemptId = evolutionInputs.swarmChampion.attemptId;
  }
  if (evolutionInputs.harnessOptimizerProposalArtifactPath) {
    config.harnessOptimizerProposalArtifactPath = evolutionInputs.harnessOptimizerProposalArtifactPath;
  }

  const candidateConfig = normalizeObject(metaCandidate.candidate?.config);
  return {
    ...config,
    ...candidateConfig,
  };
}

function createDefaultCommandRunner(spawnImpl = spawn) {
  return async ({ cwd, command, args = [], timeoutMs } = {}) => new Promise((resolve) => {
    const child = spawnImpl(command, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : 1,
        stdout,
        stderr,
      });
    };

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', () => finish(1));
    child.on('close', (exitCode) => finish(exitCode));

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      setTimeout(() => {
        child.kill();
        finish(124);
      }, timeoutMs);
    }
  });
}

function buildSourceTreeConfig({ commandRunner, wrapReplayArtifact = false } = {}) {
  const resolvedRunner = wrapReplayArtifact
    ? async (input) => {
      const result = await commandRunner(input);
      const replayDir = path.join(input.cwd, '.harness', 'replay');
      await mkdir(replayDir, { recursive: true });
      await writeFile(
        path.join(replayDir, 'report.json'),
        `${JSON.stringify({
          replayId: `post_task_${Date.now()}`,
          command: input.command,
          args: input.args,
          cases: [{ caseId: 'post_task_smoke', passed: result.exitCode === 0 }],
        }, null, 2)}\n`,
        'utf8',
      );
      return result;
    }
    : commandRunner;

  return {
    entrypoint: 'runner.js',
    sourcePaths: ['runner.js', 'package.json'],
    configPaths: ['package.json'],
    run: {
      command: 'node',
      args: ['runner.js'],
      timeoutMs: 5000,
    },
    collect: {
      replayPaths: ['.harness/replay/report.json'],
    },
    commandRunner: resolvedRunner,
  };
}

function metricValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function createPostTaskCampaignBindings({
  task = {},
  replayReports = [],
  evolutionInputs = {},
  harnessConfig = {},
  commandRunner,
  spawnImpl = spawn,
} = {}) {
  const reports = asArray(replayReports).filter(Boolean);
  const latestReplay = reports.length ? reports[reports.length - 1] : null;
  const replayMetrics = replayMetricsFromReports(reports);
  const customRunner = typeof commandRunner === 'function';
  const runner = customRunner
    ? commandRunner
    : createDefaultCommandRunner(spawnImpl);

  return {
    maxCycles: resolveMaxCycles(harnessConfig),
    sourceTree: buildSourceTreeConfig({
      commandRunner: runner,
      wrapReplayArtifact: !customRunner,
    }),
    proposer: async (input) => {
      const sourceFiles = proposerSourceFilesFromInputs(evolutionInputs);
      const config = proposerConfigFromInputs({ task, evolutionInputs, replayReports: reports });
      const proposal = {
        candidateId: `post-task-${task.taskId || 'runtime'}-${input.cycleIndex}`,
        config,
        metricManifest: { metrics: [{ name: 'quality' }] },
        lineage: {
          metaCandidateId: evolutionInputs.metaCandidate?.candidateId || null,
          swarmChampionAttemptId: evolutionInputs.swarmChampion?.attemptId || null,
        },
      };
      if (Object.keys(sourceFiles).length > 0) {
        proposal.sourceFiles = sourceFiles;
      }
      return proposal;
    },
    evaluator: async ({ replayReport } = {}) => {
      const report = replayReport || latestReplay || replayMetrics?.report || null;
      const quality = Number(report?.aggregateScore ?? report?.metrics?.quality ?? replayMetrics?.quality);
      const besAdvisoryScore = metricValue(quality, 0.5);
      return {
        metrics: {
          quality: besAdvisoryScore,
          safety: metricValue(report?.metrics?.safety, metricValue(replayMetrics?.safety, 0.85)),
          cost: metricValue(report?.metrics?.cost, metricValue(replayMetrics?.cost, 0.5)),
          latency: metricValue(report?.metrics?.latency, metricValue(replayMetrics?.latency, 0.5)),
        },
        replayReport: report,
        evidence: {
          bes: {
            advisoryScore: besAdvisoryScore,
            authority: 'evidence_only',
            canPromote: false,
          },
          rho: {
            reportId: report?.reportId || report?.replayId || null,
            regressionCount: asArray(report?.regressions).length,
            authority: 'evidence_only',
            canPromote: false,
          },
        },
      };
    },
  };
}
