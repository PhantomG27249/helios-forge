import { createAttemptGenome } from '../bes/attemptGenome.js';
import { archiveChampion, createChampionArchive, selectBestChampion } from '../bes/championArchive.js';
import { createDiversityTracker } from '../bes/diversityTracker.js';
import { proposeMutations } from '../bes/mutationPolicy.js';
import { recombineAttempts } from '../bes/recombinationEngine.js';
import { scoreSubgoals } from '../bes/subgoalScorer.js';
import { seedAttemptStrategies } from '../bes/strategySeeder.js';
import { createVerifierGenome, mutateVerifierGenome, validateVerifierGenome } from './verifierGenome.js';

const DEFAULT_TARGETS = new Set([
  'prompt_policy',
  'retrieval_policy',
  'tool_policy',
  'runtime_policy',
  'verifier_policy',
]);

const VERIFIER_MUTATION_POLICIES = Object.freeze([
  {
    type: 'threshold_adjustment',
    expectedMetric: 'false_negative_reduction',
    thresholds: { pass: 0.8, confidence: 0.65 },
  },
  {
    type: 'rubric_prompt_refinement',
    expectedMetric: 'ambiguous_score_reduction',
    rubric: { promptRefinement: 'Emphasize visible regressions and expected deltas.' },
  },
  {
    type: 'selector_rule_expansion',
    expectedMetric: 'false_negative_reduction',
    appliesTo: ['public/**/*.js', 'public/**/*.html', 'src/harness-sidecar/vlm/**/*.js'],
    tags: ['visual', 'ui', 'vlm'],
  },
  {
    type: 'timeout_budget_adjustment',
    expectedMetric: 'flakiness_reduction',
    timeoutMs: 150000,
    budget: { maxCost: 0.6 },
  },
  {
    type: 'visual_crop_policy_adjustment',
    expectedMetric: 'ambiguous_score_reduction',
    rubric: { cropPolicy: 'compare_full_page_and_focused_regions' },
  },
  {
    type: 'ocr_weight_adjustment',
    expectedMetric: 'false_positive_reduction',
    rubric: { ocrWeight: 0.35 },
  },
]);

function safeIdPart(value) {
  return String(value || 'rho_bes')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'rho_bes';
}

function timestampPart(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return date.toISOString().replace(/[-:.]/g, '').toLowerCase();
}

function collectCoresetItems(coreset) {
  if (!coreset) return [];
  if (Array.isArray(coreset)) return coreset;
  if (Array.isArray(coreset.items)) return coreset.items;
  if (Array.isArray(coreset.traces)) return coreset.traces;
  if (Array.isArray(coreset.cases)) return coreset.cases;
  return [];
}

function collectFailureModes(traceSummary = {}, coreset) {
  const failureModes = [...(traceSummary.failureModes || [])];
  for (const item of collectCoresetItems(coreset)) {
    failureModes.push(...(item.failureModes || []));
    if (item.failureMode) failureModes.push(item.failureMode);
    failureModes.push(...(item.trace?.failureModes || []));
    failureModes.push(...(item.trace?.failures || []).map((failure) => failure.category));
    failureModes.push(...(item.trace?.recoveryEvents || []).map((event) => event.category));
  }
  return [...new Set(failureModes.filter(Boolean))].sort();
}

function subgoalIdFor(value) {
  return safeIdPart(value).replace(/^/, 'address_');
}

function buildSubgoals({ target, failureModes, coreset }) {
  const subgoals = failureModes.map((failureMode) => ({
    id: subgoalIdFor(failureMode),
    description: `Address ${failureMode}`,
    failureMode,
  }));

  subgoals.push({
    id: `tune_${safeIdPart(target)}`,
    description: `Tune ${target}`,
    target,
  });

  const coresetItems = collectCoresetItems(coreset);
  if (coresetItems.length) {
    subgoals.push({
      id: 'cover_rho_coreset',
      description: `Cover ${coresetItems.length} RHO coreset case${coresetItems.length === 1 ? '' : 's'}`,
      coresetSize: coresetItems.length,
    });
  }

  const seen = new Set();
  return subgoals.filter((subgoal) => {
    if (seen.has(subgoal.id)) return false;
    seen.add(subgoal.id);
    return true;
  });
}

function parentGenomeFor(candidate) {
  const genome = candidate?.bes?.genome || candidate?.genome;
  if (genome) return genome;

  const candidateId = candidate?.candidateId || candidate?.id;
  if (!candidateId) return null;
  return createAttemptGenome({
    id: candidateId,
    strategy: {
      id: `parent_${safeIdPart(candidateId)}`,
      name: candidate.strategy || 'parent_candidate',
    },
    subgoalIds: candidate.subgoalIds || [],
    lineage: {
      parents: [],
      generation: 0,
    },
  });
}

function verifierGenomeFromParent(candidate) {
  const parentGenome = candidate?.verifierGenome || candidate?.genome;
  if (parentGenome && validateVerifierGenome(parentGenome).valid) return parentGenome;
  const verifier = parentGenome?.verifier || candidate?.verifier;
  if (verifier) return createVerifierGenome({ verifier });
  return null;
}

function defaultVerifierGenome() {
  return createVerifierGenome({
    verifier: {
      name: 'visual-ui',
      kind: 'visual',
      tool: 'visual.verifier.run',
      appliesTo: ['public/**/*.js', 'public/**/*.html'],
      tags: ['visual', 'ui'],
      rubric: { strictness: 'balanced' },
      thresholds: { pass: 0.75, confidence: 0.6 },
      timeoutMs: 120000,
      budget: { maxCost: 0.5 },
    },
    mutation: { type: 'seed_verifier_policy' },
  });
}

function targetPatchDescription(target, genome) {
  const strategyName = genome.strategy?.name || 'unknown';
  const mutationTypes = (genome.mutations || []).map((mutation) => mutation.type).join(', ') || 'no mutation';
  return `Proposed ${target} change using ${strategyName} with ${mutationTypes}`;
}

function buildRationale({ target, failureModes, subgoals, genome, coreset }) {
  const failureText = failureModes.length ? failureModes.join(', ') : 'trace-observed harness drift';
  const subgoalText = subgoals.map((subgoal) => subgoal.id).join(', ');
  const coresetItems = collectCoresetItems(coreset);
  const coresetText = coresetItems.length
    ? ` RHO coreset cases: ${coresetItems.map((item) => item.id).filter(Boolean).join(', ') || coresetItems.length}.`
    : '';
  const lineageText = genome.lineage?.parents?.length
    ? ` BES recombine parents: ${genome.lineage.parents.join(', ')}.`
    : '';

  return [
    `Address failure modes for ${target}: ${failureText}.`,
    `BES Subgoals: ${subgoalText}.`,
    `Strategy: ${genome.strategy?.name || 'unknown'}.`,
    `${coresetText}${lineageText}`.trim(),
  ].filter(Boolean).join(' ');
}

function buildVerifierRationale({ mutationType, failureModes, coreset }) {
  const coresetItems = collectCoresetItems(coreset);
  const caseText = coresetItems
    .map((item) => item.caseId || item.id || item.taskId)
    .filter(Boolean)
    .join(', ');
  const failureText = failureModes.length ? failureModes.join(', ') : 'verifier held-out drift';
  return `Propose verifier policy ${mutationType} to address ${failureText}.${caseText ? ` Held-out cases: ${caseText}.` : ''}`;
}

export class BesMetaOptimizer {
  constructor({
    now = () => new Date(),
    idPrefix = 'rho_bes',
    maxCandidates = 4,
    taskType = 'coding_bugfix',
    mutationBudget = 3,
  } = {}) {
    this.now = now;
    this.idPrefix = idPrefix;
    this.maxCandidates = maxCandidates;
    this.taskType = taskType;
    this.mutationBudget = mutationBudget;
  }

  propose({
    traceSummary = {},
    target = 'prompt_policy',
    coreset,
    parentCandidates = [],
    candidateRun,
  } = {}) {
    const normalizedTarget = DEFAULT_TARGETS.has(target) ? target : safeIdPart(target);
    const baseId = `${safeIdPart(this.idPrefix)}_${timestampPart(this.now)}`;
    const failureModes = collectFailureModes(traceSummary, coreset);

    if (normalizedTarget === 'verifier_policy') {
      const parents = parentCandidates.map(verifierGenomeFromParent).filter(Boolean);
      const parent = parents[0] || defaultVerifierGenome();
      const policies = VERIFIER_MUTATION_POLICIES.slice(0, this.maxCandidates);
      const verifierGenomes = policies.map((policy) => mutateVerifierGenome({
        genome: parent,
        rng: () => 0.5,
        mutationPolicy: {
          mutation: {
            type: policy.type,
            createdAt: timestampPart(this.now),
          },
          appliesTo: policy.appliesTo,
          tags: policy.tags,
          rubric: policy.rubric,
          thresholds: policy.thresholds,
          timeoutMs: policy.timeoutMs,
          budget: policy.budget,
        },
      }));
      const candidates = verifierGenomes.map((verifierGenome, index) => ({
        candidateId: verifierGenome.genomeId,
        target: 'verifier_policy',
        changeType: 'bes_verifier_policy_adjustment',
        verifierGenome,
        rationale: buildVerifierRationale({
          mutationType: verifierGenome.mutation.type,
          failureModes,
          coreset,
        }),
        expectedMetric: policies[index].expectedMetric,
        requiresApproval: true,
        status: 'approval_required',
        applied: false,
        candidateRun,
        patch: {
          description: `Proposed verifier policy ${verifierGenome.mutation.type}`,
          applied: false,
          target: 'verifier_policy',
          mutationType: verifierGenome.mutation.type,
        },
      }));

      return {
        candidates,
        coreset,
        bes: {
          verifierGenomes,
          mutationTypes: verifierGenomes.map((genome) => genome.mutation.type),
        },
      };
    }

    const subgoals = buildSubgoals({ target: normalizedTarget, failureModes, coreset });
    const subgoalScore = scoreSubgoals({ subgoals, completedSubgoalIds: [] });
    const strategies = seedAttemptStrategies({
      taskType: this.taskType,
      maxAttempts: Math.max(1, this.maxCandidates),
    });

    let genomes = strategies.map((strategy, index) => createAttemptGenome({
      id: `${baseId}_genome_${String(index + 1).padStart(3, '0')}`,
      strategy,
      subgoals,
      mutations: proposeMutations({
        missingSubgoalIds: subgoalScore.missingSubgoalIds,
        failureModes,
        budget: this.mutationBudget,
      }),
      lineage: {
        parents: [],
        generation: 0,
      },
    }));

    const parents = parentCandidates.map(parentGenomeFor).filter(Boolean);
    if (parents.length >= 2) {
      const recombined = recombineAttempts({
        id: `${baseId}_genome_${String(genomes.length + 1).padStart(3, '0')}`,
        parents: parents.slice(0, 2),
      });
      genomes = [...genomes.slice(0, Math.max(0, this.maxCandidates - 1)), recombined];
    }

    genomes = genomes.slice(0, this.maxCandidates);
    const diversity = createDiversityTracker().score(genomes);
    const archive = createChampionArchive();
    for (const genome of genomes) {
      const cost = (genome.mutations || []).reduce((total, mutation) => total + mutation.budgetCost, 0);
      archiveChampion(archive, {
        attemptId: genome.id,
        score: subgoalScore.percent,
        safety: 'safe',
        cost,
        metadata: {
          target: normalizedTarget,
          strategy: genome.strategy?.name,
        },
      });
    }
    const champion = selectBestChampion(archive);

    const candidates = genomes.map((genome, index) => ({
      candidateId: `${baseId}_${String(index + 1).padStart(3, '0')}`,
      target: normalizedTarget,
      changeType: 'bes_policy_adjustment',
      rationale: buildRationale({
        target: normalizedTarget,
        failureModes,
        subgoals,
        genome,
        coreset,
      }),
      requiresApproval: true,
      status: 'approval_required',
      applied: false,
      candidateRun,
      patch: {
        description: targetPatchDescription(normalizedTarget, genome),
        applied: false,
        target: normalizedTarget,
        strategy: genome.strategy?.name,
        mutationTypes: (genome.mutations || []).map((mutation) => mutation.type),
      },
      bes: {
        genome,
        subgoalScore,
      },
    }));

    return {
      candidates,
      coreset,
      bes: {
        subgoals,
        genomes,
        diversity,
        champion,
      },
    };
  }
}
