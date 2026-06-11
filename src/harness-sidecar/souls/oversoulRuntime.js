function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function compactList(value) {
  return [...new Set(asArray(value)
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean))]
    .sort();
}

function sectionText(sections = {}, name) {
  return String(sections[name] || sections[name?.toLowerCase?.()] || '');
}

function parseKeyedLines(text = '') {
  const entries = {};
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.replace(/^[-*]\s*/, '').trim();
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    entries[key] = match[2].trim();
  }
  return entries;
}

function oversoulSections(oversoul = {}) {
  return oversoul.sections || oversoul.parsed?.sections || {};
}

function oversoulIdentity(oversoul = {}) {
  const parsed = oversoul.parsed || {};
  return {
    oversoulId: oversoul.id || parsed.id || 'oversoul',
    oversoulVersion: String(oversoul.version || parsed.version || 'unversioned'),
  };
}

function buildRoleEcology(sections = {}) {
  const roleEcology = parseKeyedLines(sectionText(sections, 'Role Ecology'));
  return {
    coreRoles: compactList(roleEcology.core_roles),
    missingRoles: compactList(roleEcology.missing_roles),
    raw: sectionText(sections, 'Role Ecology'),
  };
}

function buildStrategyPosture(sections = {}) {
  const strategyPosture = parseKeyedLines(sectionText(sections, 'Strategy Posture'));
  return {
    explorationPressure: strategyPosture.exploration_pressure || null,
    evidenceThreshold: strategyPosture.evidence_threshold || null,
    raw: sectionText(sections, 'Strategy Posture'),
  };
}

function buildGovernancePosture(sections = {}) {
  const governancePosture = parseKeyedLines(sectionText(sections, 'Governance Posture'));
  return {
    autonomyLevel: governancePosture.autonomy_level || 'advisory',
    raw: sectionText(sections, 'Governance Posture'),
  };
}

function buildSoulCoverageSignal(soulCoverage = {}) {
  const evidence = [];
  const blockers = [];
  const activeSoulCount = Number(soulCoverage.activeSoulCount || soulCoverage.activeCount || 0);
  const missingSoulCount = Number(soulCoverage.missingSoulCount || soulCoverage.missingCount || 0);

  if (activeSoulCount > 0) evidence.push('soul_records');
  if (soulCoverage.runtimeStore === true || soulCoverage.runtimeStorePresent === true) evidence.push('runtime_store');
  if (soulCoverage.promptAdapter === true || soulCoverage.promptAdapterPresent === true) evidence.push('prompt_adapter');
  if (missingSoulCount > 0) blockers.push('missing_soul_records');

  return {
    goalId: 'soul_coverage',
    evidence,
    blockers,
    notes: soulCoverage.notes || [],
  };
}

function buildOversoulCoverageSignal({ oversoul = {}, sections = {} } = {}) {
  const evidence = [];
  if (oversoul.id || oversoul.parsed?.id) evidence.push('oversoul_contract');
  if (sectionText(sections, 'Role Ecology')) evidence.push('role_ecology');
  if (sectionText(sections, 'Strategy Posture')) evidence.push('strategy_posture');
  if (sectionText(sections, 'Governance Posture')) evidence.push('governance_posture');

  return {
    goalId: 'oversoul_coverage',
    evidence,
    blockers: evidence.includes('oversoul_contract') ? [] : ['missing_oversoul_contract'],
  };
}

export function buildOversoulRuntimeContext({
  oversoul = {},
  soulCoverage = {},
} = {}) {
  const sections = oversoulSections(oversoul);
  const oversoulRef = oversoulIdentity(oversoul);

  return {
    schemaVersion: 1,
    authority: 'advisory',
    canPromote: false,
    promotionAuthority: false,
    oversoulRef,
    roleEcology: buildRoleEcology(sections),
    strategyPosture: buildStrategyPosture(sections),
    governancePosture: buildGovernancePosture(sections),
    promptAdapterNotes: oversoul.promptAdapterNotes || oversoul.parsed?.promptAdapterNotes || '',
    capabilitySignals: [
      buildSoulCoverageSignal(soulCoverage),
      buildOversoulCoverageSignal({ oversoul, sections }),
    ],
  };
}
