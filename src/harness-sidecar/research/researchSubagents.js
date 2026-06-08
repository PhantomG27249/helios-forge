export const RESEARCH_SPECIALIST_ROLES = [
  'source_finder',
  'paper_reader',
  'figure_analyst',
  'citation_auditor',
  'contradiction_reviewer',
  'implementation_planner',
];

const ROLE_DESCRIPTIONS = {
  source_finder: 'Collect and map local or approved sources.',
  paper_reader: 'Read source claims and page evidence.',
  figure_analyst: 'Review figure candidates and captions.',
  citation_auditor: 'Check claim evidence coverage.',
  contradiction_reviewer: 'Review conflicting claims.',
  implementation_planner: 'Convert evidence into implementation recommendations.',
};

function sourceIds(sources = []) {
  return sources.map((source) => source.sourceId).filter(Boolean);
}

function claimIds(claims = []) {
  return claims.map((claim) => claim.claimId).filter(Boolean);
}

function figureIds(figureCandidates = []) {
  return figureCandidates.map((figure) => figure.figureId).filter(Boolean);
}

function makeTask(role, context) {
  return {
    role,
    description: ROLE_DESCRIPTIONS[role],
    inputs: {
      question: context.question || '',
      sourceIds: sourceIds(context.sources),
      claimIds: claimIds(context.claims),
      figureIds: figureIds(context.figureCandidates),
      contradictionIds: (context.contradictions || [])
        .map((contradiction) => contradiction.contradictionId)
        .filter(Boolean),
    },
  };
}

export function createResearchSubagentPlan(context = {}) {
  return {
    question: context.question || '',
    workers: RESEARCH_SPECIALIST_ROLES.map((role) => makeTask(role, context)),
  };
}

function defaultWorker(role) {
  return async ({ task }) => {
    if (role === 'source_finder') {
      return { sourceIds: task.inputs.sourceIds };
    }
    if (role === 'paper_reader') {
      return { claimIds: task.inputs.claimIds };
    }
    if (role === 'figure_analyst') {
      return { figureIds: task.inputs.figureIds };
    }
    if (role === 'citation_auditor') {
      return { claimIds: task.inputs.claimIds, reviewed: task.inputs.claimIds.length };
    }
    if (role === 'contradiction_reviewer') {
      return { contradictionIds: task.inputs.contradictionIds };
    }

    return {
      recommendations: task.inputs.claimIds.map((claimId) => `Review implementation impact for ${claimId}`),
    };
  };
}

export async function runResearchSubagents({ plan, context = {}, workers = {} } = {}) {
  const results = [];

  for (const task of plan?.workers || []) {
    const worker = workers[task.role] || defaultWorker(task.role);
    const output = await worker({ task, context });
    results.push({
      role: task.role,
      status: 'completed',
      output,
    });
  }

  return {
    status: results.every((result) => result.status === 'completed') ? 'completed' : 'partial',
    results,
  };
}
