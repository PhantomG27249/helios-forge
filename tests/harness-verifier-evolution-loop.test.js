import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runVerifierEvolutionLoop } from '../src/harness-sidecar/meta/verifierEvolutionLoop.js';

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-verifier-loop-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function verifierGenome(mutationType = 'threshold_adjustment') {
  return {
    genomeId: `vg_loop_${mutationType}`,
    parentId: null,
    verifier: {
      name: 'visual-ui',
      kind: 'visual',
      command: null,
      tool: 'visual.verifier.run',
      appliesTo: ['public/**/*.js'],
      tags: ['visual', 'ui'],
      rubric: { strictness: 'balanced' },
      thresholds: { pass: 0.75 },
      timeoutMs: 120000,
      budget: { maxCost: 0.5 },
    },
    mutation: { type: mutationType },
    safety: {
      requiresApproval: true,
      heldOutRequired: true,
      baselineRequired: true,
    },
  };
}

test('verifier evolution loop coreset-selects evaluates archives and proposes without promotion', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const events = [];
    const genomes = [verifierGenome('threshold_adjustment'), verifierGenome('rubric_prompt_refinement')];
    const result = await runVerifierEvolutionLoop({
      workspaceRoot,
      registry: {
        verifiers: [{
          name: 'visual-ui',
          kind: 'visual',
          tool: 'visual.verifier.run',
          appliesTo: ['public/**/*.js'],
          tags: ['visual'],
        }],
      },
      verifierCases: [
        {
          caseId: 'visual-fn',
          classification: 'falseNegative',
          task: { taskId: 'task-fn', task: 'catch visual miss' },
          changedFiles: ['public/app.js'],
          expected: { shouldPass: false, tags: ['visual'] },
        },
        {
          caseId: 'visual-fp',
          classification: 'falsePositive',
          task: { taskId: 'task-fp', task: 'accept clean visual change' },
          changedFiles: ['public/app.js'],
          expected: { shouldPass: true, tags: ['visual'] },
        },
      ],
      baselineResults: [{ name: 'unit', kind: 'unit', passed: true }],
      baselineVerifierMetrics: { falseNegative: 2, falsePositive: 1, recall: 0.2, averageCost: 0.2 },
      optimizer: {
        propose: ({ target, coreset }) => ({
          candidates: genomes.map((genome, index) => ({
            candidateId: `candidate-${index}`,
            target,
            verifierGenome: genome,
            expectedMetric: 'false_negative_reduction',
            coresetSize: coreset.items.length,
          })),
        }),
      },
      verifierRunner: async ({ caseRecord }) => [{
        name: 'visual-ui',
        passed: caseRecord.expected.shouldPass,
        cost: 0.21,
        durationMs: 25,
      }],
      emitEvent: (event) => events.push(event),
    });

    assert.equal(result.promoted, false);
    assert.equal(result.coreset.selectedCount, 2);
    assert.equal(result.runs.length, 2);
    assert.equal(result.proposals.length, 2);
    assert.equal(result.proposals.every((proposal) => proposal.directApplyAllowed === false), true);
    assert.equal(result.proposals.every((proposal) => proposal.approvalRequired === true), true);
    assert.equal(result.archived.length, 2);
    assert.deepEqual(events.map((event) => event.type), [
      'verifier_evolution.started',
      'verifier_evolution.coreset_selected',
      'verifier_evolution.candidates_generated',
      'verifier_evolution.candidate_started',
      'verifier_evolution.case_completed',
      'verifier_evolution.case_completed',
      'verifier_evolution.candidate_completed',
      'verifier_evolution.candidate_completed',
      'verifier_evolution.promotion_evaluated',
      'verifier_evolution.proposal_created',
      'verifier_evolution.candidate_started',
      'verifier_evolution.case_completed',
      'verifier_evolution.case_completed',
      'verifier_evolution.candidate_completed',
      'verifier_evolution.candidate_completed',
      'verifier_evolution.promotion_evaluated',
      'verifier_evolution.proposal_created',
    ]);
  });
});
