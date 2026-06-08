import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createVerifierGenome,
  mutateVerifierGenome,
  validateVerifierGenome,
  verifierFromGenome,
} from '../src/harness-sidecar/meta/verifierGenome.js';
import { runVerifierCandidate } from '../src/harness-sidecar/meta/verifierCandidateRunner.js';
import {
  archiveVerifierCandidate,
  listVerifierCandidates,
} from '../src/harness-sidecar/meta/verifierEvolutionArchive.js';

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-verifier-evolution-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function commandVerifier(overrides = {}) {
  return {
    name: 'unit',
    kind: 'unit',
    command: 'npm test -- tests/harness-tools.test.js',
    appliesTo: ['src/**/*.js'],
    tags: ['unit'],
    timeoutMs: 90000,
    budget: { maxCost: 0.1 },
    ...overrides,
  };
}

function toolVerifier(overrides = {}) {
  return {
    name: 'visual-ui',
    kind: 'visual',
    tool: 'visual.verifier.run',
    appliesTo: ['public/**/*.js', 'public/**/*.html'],
    tags: ['visual', 'ui'],
    rubric: { strictness: 'balanced' },
    thresholds: { pass: 0.75, confidence: 0.6 },
    timeoutMs: 120000,
    budget: { maxCost: 0.35 },
    ...overrides,
  };
}

test('creates safe command verifier genomes and reconstructs verifier configs', () => {
  const genome = createVerifierGenome({
    verifier: commandVerifier(),
    parentId: 'parent_001',
    mutation: { type: 'timeout_budget_adjustment', timeoutMs: 90000 },
  });

  assert.match(genome.genomeId, /^vg_[A-Za-z0-9_-]+$/);
  assert.equal(genome.parentId, 'parent_001');
  assert.equal(genome.verifier.command, 'npm test -- tests/harness-tools.test.js');
  assert.equal(genome.verifier.tool, null);
  assert.deepEqual(genome.safety, {
    requiresApproval: true,
    heldOutRequired: true,
    baselineRequired: true,
  });
  assert.equal(validateVerifierGenome(genome).valid, true);
  assert.deepEqual(verifierFromGenome(genome), genome.verifier);
});

test('creates safe tool and visual verifier genomes', () => {
  const genome = createVerifierGenome({ verifier: toolVerifier() });

  assert.equal(genome.verifier.command, null);
  assert.equal(genome.verifier.tool, 'visual.verifier.run');
  assert.deepEqual(genome.verifier.tags, ['visual', 'ui']);
  assert.equal(validateVerifierGenome(genome).valid, true);
});

test('creates selector-rule genomes without executable command or tool', () => {
  const genome = createVerifierGenome({
    verifier: {
      name: 'visual-selector-rule',
      kind: 'selector_rule',
      appliesTo: ['public/**/*.js'],
      tags: ['visual', 'selector'],
      rubric: { reason: 'route public assets to visual verifiers' },
      thresholds: { minScoreDelta: 0.05 },
    },
    mutation: { type: 'selector_rule_expansion', addAppliesTo: ['public/**/*.html'] },
  });

  assert.equal(genome.verifier.command, null);
  assert.equal(genome.verifier.tool, null);
  assert.equal(validateVerifierGenome(genome).valid, true);
});

test('rejects unsafe command and tool genomes', () => {
  assert.throws(
    () => createVerifierGenome({ verifier: commandVerifier({ command: 'npm test && Remove-Item -Recurse .' }) }),
    /unsafe verifier command/i,
  );
  assert.throws(
    () => createVerifierGenome({ verifier: toolVerifier({ tool: '../visual.verifier.run' }) }),
    /unsafe verifier tool/i,
  );
});

test('mutates verifier genomes while preserving safety and required fields', () => {
  const parent = createVerifierGenome({ verifier: toolVerifier() });
  const mutated = mutateVerifierGenome({
    genome: parent,
    rng: () => 0.42,
    mutationPolicy: {
      mutation: { type: 'threshold_adjustment' },
      thresholds: { pass: 0.82 },
      rubric: { strictness: 'strict' },
      tags: ['visual', 'ui', 'strict'],
      budget: { maxCost: 0.4 },
    },
  });

  assert.notEqual(mutated.genomeId, parent.genomeId);
  assert.equal(mutated.parentId, parent.genomeId);
  assert.equal(mutated.verifier.name, 'visual-ui');
  assert.equal(mutated.verifier.tool, 'visual.verifier.run');
  assert.deepEqual(mutated.safety, parent.safety);
  assert.equal(mutated.verifier.thresholds.pass, 0.82);
  assert.equal(mutated.verifier.rubric.strictness, 'strict');
  assert.equal(validateVerifierGenome(mutated).valid, true);
});

test('runs verifier candidates against held-out cases and computes confusion metrics', async () => {
  const genome = createVerifierGenome({ verifier: toolVerifier() });
  const events = [];
  const outcomes = new Map([
    ['visual-layout-regression', false],
    ['clean-ui-change', true],
    ['missed-layout-regression', true],
  ]);
  const run = await runVerifierCandidate({
    genome,
    heldOutCases: [
      {
        caseId: 'visual-layout-regression',
        task: { taskId: 'task-1', task: 'catch visual regression' },
        changedFiles: ['public/app.js'],
        expected: { shouldPass: false, tags: ['visual'] },
      },
      {
        caseId: 'clean-ui-change',
        task: { taskId: 'task-2', task: 'accept clean visual update' },
        changedFiles: ['public/index.html'],
        expected: { shouldPass: true, tags: ['visual'] },
      },
      {
        caseId: 'missed-layout-regression',
        task: { taskId: 'task-3', task: 'catch subtle visual regression' },
        changedFiles: ['public/app.js'],
        expected: { shouldPass: false, tags: ['visual'] },
      },
    ],
    verifierRunner: async ({ caseRecord }) => [{
      name: genome.verifier.name,
      passed: outcomes.get(caseRecord.caseId),
      cost: 0.2,
      durationMs: caseRecord.caseId === 'clean-ui-change' ? 40 : 20,
    }],
    emitEvent: (event) => events.push(event),
  });

  assert.equal(run.candidateId, genome.genomeId);
  assert.equal(run.metrics.truePositive, 1);
  assert.equal(run.metrics.trueNegative, 1);
  assert.equal(run.metrics.falsePositive, 0);
  assert.equal(run.metrics.falseNegative, 1);
  assert.equal(run.metrics.precision, 1);
  assert.equal(run.metrics.recall, 0.5);
  assert.equal(run.metrics.flakiness, 0);
  assert.equal(run.metrics.averageCost, 0.2);
  assert.equal(run.metrics.averageLatencyMs, 26.67);
  assert.equal(run.metrics.safetyPassed, true);
  assert.deepEqual(events.map((event) => event.type), [
    'verifier_evolution.candidate_started',
    'verifier_evolution.case_completed',
    'verifier_evolution.case_completed',
    'verifier_evolution.case_completed',
    'verifier_evolution.candidate_completed',
  ]);
});

test('marks candidates unsafe when baseline smoke, unit, or security cases fail', async () => {
  const genome = createVerifierGenome({ verifier: commandVerifier() });
  const run = await runVerifierCandidate({
    genome,
    heldOutCases: [{
      caseId: 'baseline-smoke',
      task: { taskId: 'task-smoke', task: 'clean smoke check' },
      changedFiles: ['package.json'],
      expected: { shouldPass: true, tags: ['smoke'] },
    }],
    baselineResults: [{ name: 'unit', kind: 'unit', passed: true }],
    verifierRunner: async () => [{ name: 'unit', passed: false, cost: 0, durationMs: 5 }],
  });

  assert.equal(run.metrics.safetyPassed, false);
  assert.deepEqual(run.safety.failures, ['baseline-smoke']);
});

test('archives verifier candidates into the verifier-candidates directory', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const genome = createVerifierGenome({ verifier: toolVerifier(), mutation: { type: 'threshold_adjustment' } });
    const run = {
      candidateId: genome.genomeId,
      metrics: { precision: 1, recall: 0.5, safetyPassed: true },
      cases: [{ caseId: 'visual-layout-regression', passed: false }],
    };
    const decision = { status: 'approval_required', reason: 'held_out_improved' };

    const record = await archiveVerifierCandidate({ workspaceRoot, genome, run, decision });

    assert.equal(record.candidateId, genome.genomeId);
    const archiveDir = path.join(workspaceRoot, '.harness', 'meta', 'verifier-candidates', genome.genomeId);
    assert.equal((await stat(path.join(archiveDir, 'genome.json'))).isFile(), true);
    assert.equal((await stat(path.join(archiveDir, 'metrics.json'))).isFile(), true);
    assert.equal((await stat(path.join(archiveDir, 'cases.json'))).isFile(), true);
    assert.equal((await stat(path.join(archiveDir, 'decision.json'))).isFile(), true);

    assert.equal(
      await readFile(path.join(archiveDir, 'genome.json'), 'utf8'),
      `${JSON.stringify(genome, null, 2)}\n`,
    );

    const listed = await listVerifierCandidates({ workspaceRoot });
    assert.deepEqual(listed.map((candidate) => candidate.candidateId), [genome.genomeId]);
  });
});

test('archive rejects unsafe verifier candidate ids', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const genome = createVerifierGenome({ verifier: toolVerifier() });
    genome.genomeId = '../outside';

    await assert.rejects(
      archiveVerifierCandidate({
        workspaceRoot,
        genome,
        run: { candidateId: '../outside', metrics: {}, cases: [] },
        decision: {},
      }),
      /unsafe candidate id/i,
    );
  });
});
