export function compileResearchReport({
  question,
  sourceMap = [],
  claimEvidenceTable = [],
  contradictions = [],
  implementationHandoff = { recommendations: [] },
}) {
  const lines = [
    `# Research Report`,
    '',
    `## Question`,
    question,
    '',
    `## Source Map`,
    ...sourceMap.map((source) => `- ${source.sourceId}: ${source.title} (${source.path})`),
    '',
    `## Claim Evidence Table`,
    ...claimEvidenceTable.map((row) => `- ${row.claim} Evidence: ${(row.evidence || []).join(', ')}`),
    '',
    `## Contradictions`,
    ...(contradictions.length ? contradictions.map((item) => `- ${item}`) : ['- None recorded']),
    '',
    `## Implementation Handoff`,
    ...(implementationHandoff.recommendations || []).map((item) => `- ${item}`),
  ];

  return lines.join('\n');
}
