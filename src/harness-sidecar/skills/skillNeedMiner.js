const NEED_DEFINITIONS = [
  {
    needId: 'skill_need_visual_debugging_repair',
    title: 'Visual Debugging Repair',
    keywords: ['visual', 'screenshot', 'layout', 'artifact'],
    failureModes: ['visual_false_negative', 'missing_artifact_context'],
    targetCapabilities: ['browser.preview', 'visual.verifier.run'],
    adaptation: 'Tailor the workflow to Helios visual verifier traces and VLM artifact evidence.',
  },
  {
    needId: 'skill_need_research_citation_repair',
    title: 'Research Citation Repair',
    keywords: ['research', 'citation', 'synthesis'],
    failureModes: ['citation_missing', 'research_synthesis_drift'],
    targetCapabilities: ['web.search', 'artifact.citation_check'],
    adaptation: 'Tailor the workflow to Helios research synthesis traces and citation evidence.',
  },
  {
    needId: 'skill_need_tool_mcp_call_repair',
    title: 'Tool And MCP Call Repair',
    keywords: ['tool', 'mcp', 'function'],
    failureModes: ['malformed_mcp_call', 'malformed_tool_use'],
    targetCapabilities: ['mcp.tool.call'],
    adaptation: 'Tailor the workflow to malformed MCP/tool call traces.',
  },
  {
    needId: 'skill_need_approval_resume_repair',
    title: 'Approval Resume Repair',
    keywords: ['approval', 'resume', 'permission'],
    failureModes: ['approval_confusion', 'unsafe_resume'],
    targetCapabilities: ['approval.resume'],
    adaptation: 'Tailor the workflow to approval-resume safety and operator confirmation traces.',
  },
  {
    needId: 'skill_need_memory_rag_retrieval_repair',
    title: 'Memory And RAG Retrieval Repair',
    keywords: ['memory', 'rag', 'retrieval', 'context'],
    failureModes: ['memory_retrieval_miss', 'rag_context_gap'],
    targetCapabilities: ['memory.search', 'rag.retrieve'],
    adaptation: 'Tailor the workflow to Helios memory and RAG retrieval misses.',
  },
  {
    needId: 'skill_need_verifier_evidence_repair',
    title: 'Verifier Evidence Repair',
    keywords: ['verifier', 'evidence', 'proof'],
    failureModes: ['missing_verifier_evidence'],
    targetCapabilities: ['verifier.run'],
    adaptation: 'Tailor the workflow to missing verifier evidence and replay proof traces.',
  },
];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectTraceFailureModes(trace = {}) {
  return [
    ...asArray(trace.failureModes),
    ...asArray(trace.reasons),
    ...asArray(trace.failures).map((failure) => failure?.category),
    ...asArray(trace.recoveryEvents).map((event) => event?.category),
    trace.verifierEvidence?.missing ? 'missing_verifier_evidence' : null,
  ].filter(Boolean);
}

function collectCoresetItems(coreset) {
  if (Array.isArray(coreset)) return coreset;
  return coreset?.items || coreset?.cases || coreset?.traces || [];
}

function collectItemFailureModes(item = {}) {
  return [
    ...asArray(item.failureModes),
    ...asArray(item.reasons),
    item.failureMode,
    item.reason,
    ...collectTraceFailureModes(item.trace),
  ].filter(Boolean);
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function capabilityText(capability = {}) {
  return [
    capability.id,
    capability.name,
    capability.package,
    capability.qualifiedName,
    capability.url,
    capability.trigger,
    capability.metadata?.trigger,
    capability.metadata?.description,
    capability.metadata?.package,
  ].filter(Boolean).join(' ').toLowerCase();
}

function findScaffold(existingCapabilities = []) {
  const scaffold = existingCapabilities.find((capability) => {
    const text = capabilityText(capability);
    return text.includes('anthropics/skill-creator') || text.includes('skill creator') || text.includes('skill-creator');
  });
  if (!scaffold) return null;
  return {
    source: scaffold.url?.includes('smithery.ai') ? 'smithery' : scaffold.source || 'installed_skill',
    qualifiedName: scaffold.package || scaffold.qualifiedName || scaffold.metadata?.package || 'anthropics/skill-creator',
    url: scaffold.url || 'https://smithery.ai/skills/anthropics/skill-creator',
    usage: 'structure_and_rubric_seed',
  };
}

function findDuplicateOrSourceSkill(definition, existingCapabilities = []) {
  return existingCapabilities.find((capability) => {
    if (capability.type && capability.type !== 'skill') return false;
    const text = capabilityText(capability);
    return definition.keywords.some((keyword) => text.includes(keyword))
      || definition.failureModes.some((mode) => text.includes(mode.replace(/_/g, ' ')));
  });
}

function evidenceForDefinition({ definition, tracesById, coresetItems }) {
  const evidence = [];
  for (const item of coresetItems) {
    const traceId = item.traceId || item.trace?.traceId || item.id || item.taskId;
    const modes = collectItemFailureModes(item);
    const trace = tracesById.get(traceId);
    const traceModes = collectTraceFailureModes(trace);
    const allModes = [...modes, ...traceModes];
    const reason = allModes.find((mode) => definition.failureModes.includes(mode));
    if (reason && !evidence.some((entry) => entry.traceId === traceId)) {
      evidence.push({
        traceId,
        eventId: item.id || item.eventId || null,
        reason,
      });
    }
  }

  for (const trace of tracesById.values()) {
    const allModes = collectTraceFailureModes(trace);
    const reason = allModes.find((mode) => definition.failureModes.includes(mode));
    if (reason && !evidence.some((entry) => entry.traceId === trace.traceId)) {
      evidence.push({ traceId: trace.traceId, eventId: null, reason });
    }
  }
  return evidence;
}

export function mineSkillNeedsFromRho({ coreset, traces = [], existingCapabilities = [] } = {}) {
  const coresetItems = collectCoresetItems(coreset);
  const tracesById = new Map(traces.map((trace) => [trace.traceId || trace.id, trace]));
  const scaffold = findScaffold(existingCapabilities);

  return NEED_DEFINITIONS.map((definition) => {
    const evidence = evidenceForDefinition({ definition, tracesById, coresetItems });
    if (!evidence.length) return null;
    const duplicate = findDuplicateOrSourceSkill(definition, existingCapabilities);
    const priority = Math.min(0.99, 0.55 + evidence.length * 0.16 + definition.failureModes.length * 0.03);
    const need = {
      needId: definition.needId,
      title: definition.title,
      failureModes: definition.failureModes.filter((mode) => evidence.some((entry) => entry.reason === mode)),
      evidence,
      targetCapabilities: definition.targetCapabilities,
      priority,
    };
    if (duplicate) {
      need.duplicateOf = duplicate.id || duplicate.name;
      need.sourceSkill = {
        name: duplicate.name || duplicate.id,
        path: duplicate.path || duplicate.file || null,
        permission: 'snapshot_for_local_evaluation_only',
      };
      need.requestedAdaptation = definition.adaptation;
    }
    if (scaffold) need.scaffold = scaffold;
    return need;
  })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority || a.needId.localeCompare(b.needId));
}
