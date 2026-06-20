import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';
import { loadEvolutionBridgeContext } from './evolutionBridgeContext.js';
import { loadIcrBridgeContext } from './icrBridgeContext.js';
import { loadMemoryBridgeContext } from './memoryBridgeContext.js';
import { loadSkillBridgeContext } from './skillContextLoader.js';
import { loadSoulBridgeContext } from './soulBridgeContext.js';

export const PI_BRIDGE_CONTEXT_SCHEMA_VERSION = 1;
const DEFAULT_BYTE_BUDGET = 12_000;
const DEFAULT_RENDER_MAX_CHARS = 6_000;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function truncateText(text, maxChars) {
  const body = String(text || '');
  if (body.length <= maxChars) return body;
  return `${body.slice(0, Math.max(0, maxChars - 3))}...`;
}

function jsonByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function quarantineSection(section) {
  return quarantineModelVisiblePayload(section).value;
}

export async function buildPiBridgeContextPack({
  workspaceRoot,
  harnessConfig = {},
  task = {},
  options = {},
  deps = {},
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const byteBudget = options.byteBudget ?? DEFAULT_BYTE_BUDGET;
  const features = harnessConfig.features || {};
  const loadSkills = deps.loadSkillBridgeContext || loadSkillBridgeContext;
  const loadSouls = deps.loadSoulBridgeContext || loadSoulBridgeContext;
  const loadEvolution = deps.loadEvolutionBridgeContext || loadEvolutionBridgeContext;
  const loadMemory = deps.loadMemoryBridgeContext || loadMemoryBridgeContext;
  const loadIcr = deps.loadIcrBridgeContext || loadIcrBridgeContext;

  const [skills, souls, evolution, memory, icr] = await Promise.all([
    loadSkills({ workspaceRoot, repoRoot: options.repoRoot, includeShadowCandidates: true }),
    loadSouls({ workspaceRoot, agentId: task.agentId || options.agentId }),
    loadEvolution({ workspaceRoot }),
    features.localMemoryGraph !== false
      ? loadMemory({ workspaceRoot, harnessConfig, task })
      : Promise.resolve(null),
    features.icr?.enabled === true || harnessConfig.icr?.enabled === true
      ? loadIcr({ workspaceRoot, harnessConfig })
      : Promise.resolve(null),
  ]);

  const pack = quarantineSection({
    schemaVersion: PI_BRIDGE_CONTEXT_SCHEMA_VERSION,
    skills: quarantineSection(skills),
    souls: quarantineSection(souls),
    evolution: quarantineSection(evolution),
    memory: memory ? quarantineSection(memory) : null,
    icr: icr ? quarantineSection(icr) : null,
    promotion: {
      queueCount: evolution?.promotionQueueCount ?? 0,
      evidenceOnly: true,
      canPromote: false,
    },
    authority: {
      evidenceOnly: true,
      canPromote: false,
      durableApplyApproval: 'operator_only',
    },
    byteBudget,
    renderStats: {},
  });

  pack.renderStats = {
    bytes: jsonByteLength(pack),
    truncated: pack.renderStats.bytes > byteBudget,
  };
  if (pack.renderStats.bytes > byteBudget) {
    if (pack.skills?.skills?.length > 2) {
      pack.skills.skills = pack.skills.skills.slice(0, 2);
    }
    if (pack.skills?.shadowHints?.length > 1) {
      pack.skills.shadowHints = pack.skills.shadowHints.slice(0, 1);
    }
    pack.renderStats.bytes = jsonByteLength(pack);
    pack.renderStats.truncated = true;
  }

  return pack;
}

export function renderPiBridgeContextMarkdown(pack, { maxChars = DEFAULT_RENDER_MAX_CHARS } = {}) {
  if (!pack || typeof pack !== 'object') return null;

  const lines = ['[Helios Forge]', 'Unified Helios bridge context (advisory, evidence-only).'];

  const skillEntries = [
    ...asArray(pack.skills?.skills),
    ...asArray(pack.skills?.shadowHints).map((hint) => ({
      name: `${hint.name} [shadow]`,
      excerpt: hint.excerpt,
    })),
  ];
  if (skillEntries.length) {
    lines.push('Skills:');
    for (const skill of skillEntries.slice(0, 6)) {
      const excerpt = skill.excerpt ? truncateText(skill.excerpt.replace(/\s+/g, ' '), 240) : '';
      lines.push(`- ${skill.name || skill.id}${excerpt ? `: ${excerpt}` : ''}`);
    }
  }

  if (pack.souls?.markdown) {
    lines.push('Soul / oversoul:');
    lines.push(truncateText(pack.souls.markdown, 900));
  }

  const goals = asArray(pack.evolution?.goals);
  if (goals.length) {
    lines.push(`Evolution goals: ${goals.join(', ')}`);
  }
  if (pack.evolution?.latestReplay) {
    const replay = pack.evolution.latestReplay;
    lines.push(`Latest replay: ${replay.reportId || 'unknown'} score ${replay.aggregateScore ?? 'n/a'}, regressions ${replay.regressionCount ?? 0}`);
  }
  if (pack.evolution?.frontier?.trend) {
    lines.push(`Frontier trend: ${pack.evolution.frontier.trend}`);
  }
  if (Number(pack.promotion?.queueCount) > 0) {
    lines.push(`Promotion queue (pending operator review): ${pack.promotion.queueCount}`);
  }

  if (pack.memory?.summary) {
    lines.push(`Memory graph: ${truncateText(pack.memory.summary, 512)}`);
  }
  if (pack.icr?.summary) {
    lines.push(`ICR lane: ${truncateText(pack.icr.summary, 512)}`);
  }

  lines.push('Authority: advisory only — no auto-promote or durable apply from model context.');
  lines.push('Slash commands: /harness, /research, /deep-research, /forge');
  lines.push('[/Helios Forge]');

  return truncateText(lines.join('\n'), maxChars);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function compactPiBridgeContextForSwarm(pack = {}) {
  const skillHints = [
    ...asArray(pack.skills?.skills).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: truncateText(skill.excerpt, 400),
      authority: 'advisory_only',
    })),
    ...asArray(pack.skills?.shadowHints).map((hint) => ({
      id: hint.candidateId,
      name: hint.name,
      description: truncateText(`${hint.status}: ${hint.excerpt || ''}`, 400),
      authority: 'advisory_only',
    })),
  ];

  const soulRefs = pack.souls?.agentId
    ? [{ soulId: pack.souls.agentId, soulVersion: '1' }]
    : [];

  const oversoulRefs = pack.souls?.oversoulRef?.oversoulId
    ? [{
      oversoulId: pack.souls.oversoulRef.oversoulId,
      oversoulVersion: pack.souls.oversoulRef.oversoulVersion,
    }]
    : [];

  const modelWarnings = [];
  if (asArray(pack.evolution?.goals).length) {
    modelWarnings.push({
      code: 'evolution_goals',
      message: `Evolution goals: ${pack.evolution.goals.join(', ')}`,
      severity: 'info',
    });
  }
  if (pack.evolution?.latestReplay) {
    modelWarnings.push({
      code: 'replay_evidence',
      message: `Replay ${pack.evolution.latestReplay.reportId}: score ${pack.evolution.latestReplay.aggregateScore ?? 'n/a'}`,
      severity: pack.evolution.latestReplay.regressionCount > 0 ? 'warn' : 'info',
    });
  }
  if (Number(pack.promotion?.queueCount) > 0) {
    modelWarnings.push({
      code: 'promotion_queue',
      message: `${pack.promotion.queueCount} promotion proposal(s) awaiting operator review`,
      severity: 'info',
    });
  }
  if (pack.memory?.summary) {
    modelWarnings.push({
      code: 'memory_graph',
      message: truncateText(pack.memory.summary, 256),
      severity: 'info',
    });
  }
  if (pack.icr?.summary) {
    modelWarnings.push({
      code: 'icr_lane',
      message: truncateText(pack.icr.summary, 256),
      severity: 'info',
    });
  }

  return {
    skillHints,
    soulRefs,
    oversoulRefs,
    modelWarnings,
    authorityBoundary: {
      durableApplyApproval: 'forbidden_for_pi_native',
      piNativeOutput: 'advisory_only',
    },
    evidenceOnly: true,
    canPromote: false,
  };
}

export function buildContextPackSummaryForExtension(pack = {}) {
  return {
    schemaVersion: pack.schemaVersion || PI_BRIDGE_CONTEXT_SCHEMA_VERSION,
    skillCount: asArray(pack.skills?.skills).length,
    shadowSkillCount: asArray(pack.skills?.shadowHints).length,
    hasSoul: Boolean(pack.souls?.markdown),
    evolutionGoalCount: asArray(pack.evolution?.goals).length,
    promotionQueueCount: pack.promotion?.queueCount ?? 0,
    hasMemory: Boolean(pack.memory?.summary),
    hasIcr: Boolean(pack.icr?.summary),
    bytes: pack.renderStats?.bytes ?? jsonByteLength(pack),
    truncated: pack.renderStats?.truncated === true,
    evidenceOnly: true,
    canPromote: false,
  };
}
