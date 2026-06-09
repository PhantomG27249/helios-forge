import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildAdaptiveSearchContextForResearch,
  normalizeAdaptiveSearchRewardForResearch,
} from '../bes/adaptiveSearchAdapters.js';
import {
  recordAdaptiveSearchOutcome,
  selectAdaptiveSearchAction,
} from '../bes/adaptiveSearchScheduler.js';
import { extractFigureCandidates } from './figureExtractor.js';
import { assessNoveltyAndRisk } from './noveltyControls.js';
import {
  createResearchSubagentPlan,
  runResearchSubagents,
} from './researchSubagents.js';

function makeResearchId() {
  return `research_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDeepResearchReport({ question, sources = [] }) {
  const sourceMap = sources.map((source) => ({
    sourceId: source.sourceId,
    title: source.title,
    path: source.path,
  }));

  const claimEvidenceTable = sources.flatMap((source) => (
    (source.claims || []).map((claim, index) => ({
      claimId: `${source.sourceId}_claim_${index + 1}`,
      claim,
      evidence: [source.sourceId],
    }))
  ));

  return {
    researchId: makeResearchId(),
    question,
    sourceMap,
    claimEvidenceTable,
    contradictions: [],
    implementationHandoff: {
      recommendations: claimEvidenceTable.length
        ? ['Convert verified claims into implementation tasks.']
        : ['Collect sources before implementation planning.'],
    },
  };
}

function assertSafeRunId(runId) {
  if (!/^[A-Za-z0-9_.-]+$/.test(runId || '')) {
    throw new Error(`Unsafe research run id: ${runId}`);
  }
}

function normalizeSourceMap({ sources, pageMetadata }) {
  const pagesBySource = new Map();
  for (const page of pageMetadata) {
    const pages = pagesBySource.get(page.sourceId) || [];
    pages.push(page);
    pagesBySource.set(page.sourceId, pages);
  }

  return {
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      title: source.title || source.sourceId,
      type: source.type || 'local',
      locator: source.locator || source.path || source.url || source.sourceId,
      pages: pagesBySource.get(source.sourceId) || [],
    })),
  };
}

function collectClaims(sources) {
  return sources.flatMap((source, sourceIndex) => {
    const sourceId = source.sourceId || `src_${sourceIndex + 1}`;
    return (source.claims || []).map((claim, claimIndex) => {
      if (typeof claim === 'string') {
        return {
          claimId: `${sourceId}_claim_${claimIndex + 1}`,
          sourceId,
          claim,
          evidence: [{ sourceId }],
        };
      }

      return {
        sourceId,
        ...claim,
        claimId: claim.claimId || `${sourceId}_claim_${claimIndex + 1}`,
        claim: claim.claim || claim.text || '',
        evidence: claim.evidence || [],
      };
    });
  });
}

function claimEvidenceGraph({ claims, contradictions, figureCandidates, riskFlags }) {
  return {
    claims,
    evidenceEdges: claims.flatMap((claim) => (
      (claim.evidence || []).map((evidence, index) => ({
        edgeId: `${claim.claimId}_evidence_${index + 1}`,
        claimId: claim.claimId,
        sourceId: evidence.sourceId || null,
        figureId: evidence.figureId || null,
        quote: evidence.quote || null,
      }))
    )),
    figures: figureCandidates,
    contradictions,
    riskFlags,
  };
}

function renderFigureNotes({ pageMetadata, figureCandidates }) {
  const lines = ['# Figure Notes', ''];

  if (!figureCandidates.length) {
    lines.push('- No figure candidates found.');
  } else {
    for (const figure of figureCandidates) {
      lines.push(`- ${figure.label} (${figure.figureId}) page ${figure.pageNumber}: ${figure.caption}`);
    }
  }

  lines.push('', '## PDF Pages');
  if (!pageMetadata.length) {
    lines.push('- No PDF page metadata found.');
  } else {
    for (const page of pageMetadata) {
      lines.push(`- ${page.sourceId} page ${page.pageNumber}: ${page.width}x${page.height}, text length ${page.textLength}`);
    }
  }

  return lines.join('\n');
}

function renderContradictions(contradictions = []) {
  const lines = ['# Contradictions', ''];
  if (!contradictions.length) {
    lines.push('- None recorded.');
    return lines.join('\n');
  }

  for (const contradiction of contradictions) {
    lines.push(`- ${contradiction.contradictionId}: claims ${(contradiction.claimIds || []).join(', ')}`);
    if ((contradiction.values || []).length) {
      lines.push(`  Values: ${contradiction.values.join(', ')}`);
    }
  }

  return lines.join('\n');
}

function recommendationForFlag(flag) {
  if (flag.kind === 'unsupported_high_novelty') {
    return `Resolve unsupported high novelty claim ${flag.claimId} before implementation.`;
  }
  if (flag.kind === 'figure_only_evidence') {
    return `Find text evidence for figure-only claim ${flag.claimId}.`;
  }
  if (flag.kind === 'contradiction_requires_review') {
    return `Resolve contradiction ${flag.contradictionId} before committing recommendations.`;
  }
  return flag.message;
}

function renderImplementationRecommendations({ riskFlags, claims }) {
  const lines = ['# Implementation Recommendations', ''];
  const recommendations = [
    ...riskFlags.map(recommendationForFlag),
    ...claims
      .filter((claim) => (claim.evidence || []).length > 0)
      .map((claim) => `Use supported claim ${claim.claimId} as implementation input.`),
  ];

  if (!recommendations.length) {
    lines.push('- Collect source-grounded claims before implementation planning.');
  } else {
    lines.push(...recommendations.map((recommendation) => `- ${recommendation}`));
  }

  return lines.join('\n');
}

function renderFinalReport({
  question,
  sourceMap,
  graph,
  figureNotes,
  contradictionsMarkdown,
  recommendationsMarkdown,
  subagentRun,
  riskLevel,
}) {
  return [
    '# Research Report',
    '',
    '## Question',
    question,
    '',
    '## Source Map',
    ...sourceMap.sources.map((source) => `- ${source.sourceId}: ${source.title} (${source.locator})`),
    '',
    '## Claim Evidence Graph',
    `- Claims: ${graph.claims.length}`,
    `- Evidence edges: ${graph.evidenceEdges.length}`,
    `- Risk level: ${riskLevel}`,
    '',
    '## Figure Notes',
    ...figureNotes.split('\n').slice(2),
    '',
    '## Contradictions',
    ...contradictionsMarkdown.split('\n').slice(2),
    '',
    '## Implementation Recommendations',
    ...recommendationsMarkdown.split('\n').slice(2),
    '',
    '## Specialist Workers',
    ...(subagentRun.results || []).map((result) => `- ${result.role}: ${result.status}`),
    '',
    '## Production Artifacts',
    '- source_map.json',
    '- claim_evidence_graph.json',
    '- figure_notes.md',
    '- contradictions.md',
    '- implementation_recommendations.md',
    '- final_report.md',
  ].join('\n');
}

function activeAdaptiveSearch(adaptiveSearch) {
  if (adaptiveSearch?.enabled !== true || !adaptiveSearch.scheduler) return null;
  return adaptiveSearch;
}

function selectResearchAdaptiveSearch({ adaptiveSearch, runId, question, sources, contradictions }) {
  const activeSearch = activeAdaptiveSearch(adaptiveSearch);
  if (!activeSearch) return null;
  return selectAdaptiveSearchAction({
    scheduler: activeSearch.scheduler,
    context: buildAdaptiveSearchContextForResearch({
      taskId: activeSearch.context?.taskId || runId,
      question,
      sources,
      contradictions,
      ...(activeSearch.context || {}),
      budget: {
        ...(activeSearch.context?.budget || {}),
        ...(activeSearch.budget || {}),
      },
    }),
  });
}

function recordResearchAdaptiveOutcome({ adaptiveSearch, action, result }) {
  if (!action) return null;
  const sourceCount = result.sourceMap?.sources?.length || 0;
  const claimCount = result.claimEvidenceGraph?.claims?.length || 0;
  const evidenceCount = result.claimEvidenceGraph?.evidenceEdges?.length || 0;
  const riskLevel = result.noveltyControls?.riskLevel;
  return recordAdaptiveSearchOutcome({
    scheduler: adaptiveSearch.scheduler,
    actionId: action.actionId,
    reward: normalizeAdaptiveSearchRewardForResearch({
      sourceQuality: sourceCount ? 0.64 : 0.35,
      synthesisConfidence: claimCount ? 0.62 : 0.42,
      citationCoverage: claimCount ? evidenceCount / Math.max(1, claimCount) : 0.4,
      safetyRejected: riskLevel === 'high' && evidenceCount === 0,
    }),
    evidence: {
      runId: result.runId,
      sourceCount,
      claimCount,
      riskLevel,
    },
  });
}

async function writeArtifact({ artifactDir, name, content }) {
  const artifactPath = path.join(artifactDir, name);
  await writeFile(artifactPath, content, 'utf8');
  return {
    name,
    path: artifactPath,
  };
}

export async function createDeepResearchV2Artifacts({
  workspaceRoot = process.cwd(),
  runId = makeResearchId(),
  question,
  sources = [],
  contradictions = [],
  workers,
  researchPolicy = null,
  adaptiveSearch,
} = {}) {
  assertSafeRunId(runId);
  const adaptiveAction = selectResearchAdaptiveSearch({
    adaptiveSearch,
    runId,
    question,
    sources,
    contradictions,
  });

  const artifactDir = path.join(workspaceRoot, '.harness', 'research', runId, 'artifacts');
  await mkdir(artifactDir, { recursive: true });

  const { pageMetadata, figureCandidates } = extractFigureCandidates({ sources });
  const claims = collectClaims(sources);
  const noveltyControls = assessNoveltyAndRisk({
    claims,
    contradictions,
    figureCandidates,
    researchPolicy,
  });
  const sourceMap = normalizeSourceMap({ sources, pageMetadata });
  const graph = claimEvidenceGraph({
    claims,
    contradictions,
    figureCandidates,
    riskFlags: noveltyControls.flags,
  });
  const plan = createResearchSubagentPlan({
    question,
    sources,
    claims,
    figureCandidates,
    contradictions,
  });
  const subagentRun = await runResearchSubagents({ plan, context: { question }, workers });
  const figureNotes = renderFigureNotes({ pageMetadata, figureCandidates });
  const contradictionsMarkdown = renderContradictions(contradictions);
  const recommendationsMarkdown = renderImplementationRecommendations({
    riskFlags: noveltyControls.flags,
    claims,
  });
  const finalReport = renderFinalReport({
    question,
    sourceMap,
    graph,
    figureNotes,
    contradictionsMarkdown,
    recommendationsMarkdown,
    subagentRun,
    riskLevel: noveltyControls.riskLevel,
  });

  const artifactSpecs = [
    ['source_map.json', `${JSON.stringify(sourceMap, null, 2)}\n`],
    ['claim_evidence_graph.json', `${JSON.stringify(graph, null, 2)}\n`],
    ['figure_notes.md', figureNotes],
    ['contradictions.md', contradictionsMarkdown],
    ['implementation_recommendations.md', recommendationsMarkdown],
    ['final_report.md', finalReport],
  ];

  const artifacts = [];
  for (const [name, content] of artifactSpecs) {
    artifacts.push(await writeArtifact({ artifactDir, name, content }));
  }

  const result = {
    runId,
    artifactDir,
    artifacts,
    sourceMap,
    claimEvidenceGraph: graph,
    figureCandidates,
    noveltyControls,
    subagentRun,
  };
  if (!adaptiveAction) return result;
  return {
    ...result,
    adaptiveSearch: {
      action: adaptiveAction,
      outcome: recordResearchAdaptiveOutcome({
        adaptiveSearch,
        action: adaptiveAction,
        result,
      }),
    },
  };
}
