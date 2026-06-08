function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function candidateId(candidate, fallback) {
  return String(candidate?.candidateId || candidate?.id || fallback);
}

function normalizeScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeEvaluation(candidate, evaluation = {}) {
  const metrics = evaluation.metrics || {};
  const score = normalizeScore(evaluation.score ?? metrics.combinedScore ?? metrics.score);
  return {
    ...candidate,
    candidateId: candidateId(candidate, 'candidate'),
    score,
    correct: evaluation.correct !== false,
    metrics,
    visual: evaluation.visual || null,
    verifier: evaluation.verifier || null,
    evaluation,
  };
}

function compareArchiveEntries(left, right) {
  if (left.correct !== right.correct) return left.correct ? -1 : 1;
  if (right.score !== left.score) return right.score - left.score;
  return left.candidateId.localeCompare(right.candidateId);
}

function createIslands(count, initialCandidates) {
  const safeCount = Math.max(1, Math.floor(count || 1));
  const islands = Array.from({ length: safeCount }, (_, index) => ({
    islandId: `island_${index + 1}`,
    population: [],
  }));

  initialCandidates.forEach((candidate, index) => {
    const explicitIsland = islands.find((island) => island.islandId === candidate.islandId);
    const selected = explicitIsland || islands[index % islands.length];
    selected.population.push({
      ...candidate,
      candidateId: candidateId(candidate, `seed_${index + 1}`),
      islandId: selected.islandId,
      generation: 0,
    });
  });

  return islands;
}

function updateArchive(archive, entries, archiveSize) {
  const byId = new Map();
  for (const entry of [...archive, ...entries]) {
    byId.set(entry.candidateId, entry);
  }
  const sorted = [...byId.values()].sort(compareArchiveEntries);
  const safeSize = Math.max(1, archiveSize);
  const selected = sorted.slice(0, safeSize);
  const rejected = sorted.filter((entry) => entry.correct === false);
  if (
    safeSize > 1 &&
    rejected.length > 0 &&
    selected.every((entry) => entry.correct !== false)
  ) {
    selected[selected.length - 1] = rejected[0];
    selected.sort(compareArchiveEntries);
  }
  return selected;
}

function bestFromPopulation(population) {
  return population.slice().sort(compareArchiveEntries)[0] || population[0];
}

async function defaultMutateCandidate({ parent, generation }) {
  return {
    ...parent,
    candidateId: `${parent.candidateId}_g${generation}`,
    generation,
  };
}

async function defaultEvaluateCandidate() {
  return { score: 0, correct: true, metrics: { combinedScore: 0 } };
}

export async function runEvolutionPopulation({
  task = {},
  initialCandidates = [],
  generations = 1,
  islands = 1,
  archiveSize = 8,
  visualCases = [],
  verifierCases = [],
  mutateCandidate = defaultMutateCandidate,
  evaluateCandidate = defaultEvaluateCandidate,
} = {}) {
  if (!initialCandidates.length) {
    throw new Error('initialCandidates are required');
  }
  if (typeof mutateCandidate !== 'function') throw new Error('mutateCandidate must be a function');
  if (typeof evaluateCandidate !== 'function') throw new Error('evaluateCandidate must be a function');

  const evaluationContext = {
    task,
    visualCases: asArray(visualCases),
    verifierCases: asArray(verifierCases),
  };
  const events = [];
  if (evaluationContext.visualCases.length) {
    events.push({
      type: 'evolution.visual_cases_attached',
      taskId: task.taskId,
      caseCount: evaluationContext.visualCases.length,
      caseIds: evaluationContext.visualCases.map((item, index) => item.caseId || item.id || `visual_${index + 1}`),
    });
  }

  const islandState = createIslands(islands, initialCandidates);
  let archive = [];
  for (const island of islandState) {
    const evaluatedSeeds = [];
    for (const seed of island.population) {
      const evaluation = await evaluateCandidate({ candidate: seed, generation: 0, island, evaluationContext });
      evaluatedSeeds.push(normalizeEvaluation(seed, evaluation));
    }
    island.population = evaluatedSeeds;
    archive = updateArchive(archive, evaluatedSeeds, archiveSize);
  }

  const generationRecords = [];
  const maxGenerations = Math.max(0, Math.floor(generations));
  for (let generation = 1; generation <= maxGenerations; generation += 1) {
    const generated = [];

    for (const island of islandState) {
      const parent = bestFromPopulation(island.population);
      if (!parent) continue;
      const mutated = await mutateCandidate({
        parent,
        generation,
        island,
        archive,
        evaluationContext,
      });
      const candidate = {
        ...mutated,
        candidateId: candidateId(mutated, `${parent.candidateId}_g${generation}`),
        islandId: island.islandId,
        generation,
        lineage: {
          parent: parent.candidateId,
          generation,
        },
      };
      const evaluation = await evaluateCandidate({
        candidate,
        parent,
        generation,
        island,
        archive,
        evaluationContext,
      });
      const evaluated = normalizeEvaluation(candidate, evaluation);
      island.population = updateArchive(island.population, [evaluated], island.population.length + 1);
      generated.push(evaluated);
    }

    archive = updateArchive(archive, generated, archiveSize);
    generationRecords.push({
      generation,
      candidates: generated,
      best: archive[0] || null,
    });
    events.push({
      type: 'evolution.archive_updated',
      taskId: task.taskId,
      generation,
      archiveSize: archive.length,
      bestCandidateId: archive[0]?.candidateId,
      bestScore: archive[0]?.score,
    });
  }

  return {
    task,
    islands: islandState.map((island) => ({
      islandId: island.islandId,
      populationSize: island.population.length,
      best: bestFromPopulation(island.population) || null,
    })),
    generations: generationRecords,
    archive,
    best: archive[0] || null,
    events,
    evaluationContext,
  };
}

export function runEvolutionPopulationSync({
  task = {},
  initialCandidates = [],
  generations = 1,
  islands = 1,
  archiveSize = 8,
  visualCases = [],
  verifierCases = [],
  mutateCandidate = ({ parent, generation }) => ({
    ...parent,
    candidateId: `${parent.candidateId}_g${generation}`,
    generation,
  }),
  evaluateCandidate = () => ({ score: 0, correct: true, metrics: { combinedScore: 0 } }),
} = {}) {
  if (!initialCandidates.length) {
    throw new Error('initialCandidates are required');
  }
  if (typeof mutateCandidate !== 'function') throw new Error('mutateCandidate must be a function');
  if (typeof evaluateCandidate !== 'function') throw new Error('evaluateCandidate must be a function');

  const evaluationContext = {
    task,
    visualCases: asArray(visualCases),
    verifierCases: asArray(verifierCases),
  };
  const events = [];
  if (evaluationContext.visualCases.length) {
    events.push({
      type: 'evolution.visual_cases_attached',
      taskId: task.taskId,
      caseCount: evaluationContext.visualCases.length,
      caseIds: evaluationContext.visualCases.map((item, index) => item.caseId || item.id || `visual_${index + 1}`),
    });
  }

  const islandState = createIslands(islands, initialCandidates);
  let archive = [];
  for (const island of islandState) {
    island.population = island.population.map((seed) => normalizeEvaluation(
      seed,
      evaluateCandidate({ candidate: seed, generation: 0, island, evaluationContext }),
    ));
    archive = updateArchive(archive, island.population, archiveSize);
  }

  const generationRecords = [];
  const maxGenerations = Math.max(0, Math.floor(generations));
  for (let generation = 1; generation <= maxGenerations; generation += 1) {
    const generated = [];
    for (const island of islandState) {
      const parent = bestFromPopulation(island.population);
      if (!parent) continue;
      const mutated = mutateCandidate({ parent, generation, island, archive, evaluationContext });
      const candidate = {
        ...mutated,
        candidateId: candidateId(mutated, `${parent.candidateId}_g${generation}`),
        islandId: island.islandId,
        generation,
        lineage: {
          parent: parent.candidateId,
          generation,
        },
      };
      const evaluated = normalizeEvaluation(
        candidate,
        evaluateCandidate({ candidate, parent, generation, island, archive, evaluationContext }),
      );
      island.population = updateArchive(island.population, [evaluated], island.population.length + 1);
      generated.push(evaluated);
    }
    archive = updateArchive(archive, generated, archiveSize);
    generationRecords.push({ generation, candidates: generated, best: archive[0] || null });
    events.push({
      type: 'evolution.archive_updated',
      taskId: task.taskId,
      generation,
      archiveSize: archive.length,
      bestCandidateId: archive[0]?.candidateId,
      bestScore: archive[0]?.score,
    });
  }

  return {
    runner: 'evolutionPopulationRunner.sync',
    task,
    islands: islandState.map((island) => ({
      islandId: island.islandId,
      populationSize: island.population.length,
      best: bestFromPopulation(island.population) || null,
    })),
    generations: generationRecords,
    archive,
    best: archive[0] || null,
    events,
    evaluationContext,
  };
}
