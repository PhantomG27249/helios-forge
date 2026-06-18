import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';

import { runReplayCycle } from '../src/harness-sidecar/benchmarks/replayCycleRunner.js';
import {
  createTaskReplayRunners,
  HeldOutSuiteRequiredError,
} from '../src/harness-sidecar/benchmarks/taskReplayRunners.js';

function createMockChild(exitCode) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    child.emit('close', exitCode, null);
  });
  return child;
}

function createRecordingSpawn(exitCodesByCommand = {}) {
  const spawns = [];
  const spawnImpl = (command, options) => {
    spawns.push({ command, options });
    const exitCode = Object.prototype.hasOwnProperty.call(exitCodesByCommand, command)
      ? exitCodesByCommand[command]
      : 0;
    return createMockChild(exitCode);
  };
  return { spawns, spawnImpl };
}

test('throws HeldOutSuiteRequiredError when suite has zero cases', () => {
  assert.throws(
    () => createTaskReplayRunners({
      workspaceRoot: '/tmp/workplace',
      suite: { id: 'empty-suite', domains: ['code'], cases: [] },
    }),
    HeldOutSuiteRequiredError,
  );
});

test('throws HeldOutSuiteRequiredError when suite cases are missing', () => {
  assert.throws(
    () => createTaskReplayRunners({
      workspaceRoot: '/tmp/workplace',
      suite: { id: 'missing-cases', domains: ['code'] },
    }),
    HeldOutSuiteRequiredError,
  );
});

test('syntheticReplay true returns explicit CI stub scores without spawning', async () => {
  const { spawns, spawnImpl } = createRecordingSpawn();
  const { baselineRunner, candidateRunner } = createTaskReplayRunners({
    workspaceRoot: '/tmp/workplace',
    suite: {
      id: 'stub-suite',
      domains: ['code'],
      cases: [{ id: 'case-1', domain: 'code', command: 'node -e "process.exit(0)"' }],
    },
    syntheticReplay: true,
    spawnImpl,
  });

  const baseline = await baselineRunner({ case: { id: 'case-1' } });
  const candidate = await candidateRunner({ case: { id: 'case-1' } });

  assert.deepEqual(baseline, { metrics: { quality: 0.5 }, passed: true });
  assert.deepEqual(candidate, { metrics: { quality: 0.55 }, passed: true });
  assert.equal(spawns.length, 0);
});

test('runs case command via spawn and maps exit code zero to quality one', async () => {
  const { spawns, spawnImpl } = createRecordingSpawn({ 'node -e "process.exit(0)"': 0 });
  const suite = {
    id: 'pass-suite',
    domains: ['code'],
    cases: [{
      id: 'pass-case',
      domain: 'code',
      command: 'node -e "process.exit(0)"',
      metricWeights: { quality: 1 },
    }],
  };
  const { baselineRunner } = createTaskReplayRunners({
    workspaceRoot: '/tmp/workplace',
    suite,
    syntheticReplay: false,
    spawnImpl,
  });

  const result = await baselineRunner({ suite, case: suite.cases[0] });

  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].command, 'node -e "process.exit(0)"');
  assert.equal(spawns[0].options.cwd, path.resolve('/tmp/workplace'));
  assert.equal(spawns[0].options.shell, true);
  assert.deepEqual(result, { passed: true, metrics: { quality: 1 } });
});

test('maps non-zero exit codes to quality zero and passed false', async () => {
  const { spawnImpl } = createRecordingSpawn({ 'node -e "process.exit(2)"': 2 });
  const suite = {
    id: 'fail-suite',
    domains: ['code'],
    cases: [{
      id: 'fail-case',
      domain: 'code',
      command: 'node -e "process.exit(2)"',
      metricWeights: { quality: 1 },
    }],
  };
  const { candidateRunner } = createTaskReplayRunners({
    workspaceRoot: '/tmp/workplace',
    suite,
    syntheticReplay: false,
    spawnImpl,
  });

  const result = await candidateRunner({ suite, case: suite.cases[0] });

  assert.deepEqual(result, { passed: false, metrics: { quality: 0 } });
});

test('replay cycle aggregate score reflects real exit codes not synthetic stub delta', async () => {
  const { spawnImpl } = createRecordingSpawn({
    'node -e "process.exit(0)"': 0,
    'node -e "process.exit(1)"': 1,
  });
  const suite = {
    id: 'real-suite',
    domains: ['code'],
    cases: [
      {
        id: 'pass-case',
        domain: 'code',
        command: 'node -e "process.exit(0)"',
        metricWeights: { quality: 1 },
      },
      {
        id: 'fail-case',
        domain: 'code',
        command: 'node -e "process.exit(1)"',
        metricWeights: { quality: 1 },
      },
    ],
  };
  const { baselineRunner, candidateRunner } = createTaskReplayRunners({
    workspaceRoot: '/tmp/workplace',
    suite,
    syntheticReplay: false,
    spawnImpl,
  });

  const report = await runReplayCycle({
    suite,
    candidates: [{ id: 'candidate-a' }],
    baselineRunner,
    candidateRunner,
    now: () => new Date('2026-06-18T00:00:00.000Z'),
  });

  assert.equal(report.domainScores.code.baselineScore, 0.5);
  assert.equal(report.domainScores.code.bestCandidateScore, 0.5);
  assert.equal(report.aggregateScore, 0);
  assert.notEqual(report.aggregateScore, 0.05);
});
