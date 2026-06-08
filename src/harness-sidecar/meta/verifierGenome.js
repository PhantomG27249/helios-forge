import crypto from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9_.:-]+$/;
const SAFE_TOOL = /^[A-Za-z0-9_.:-]+$/;
const SAFE_COMMAND_PREFIX = /^(npm|node|npx|pnpm|yarn|git)\b/;
const UNSAFE_COMMAND = /(\r|\n|&&|\|\||[;|`<>]|\$\(|\brm\s+-rf\b|\bremove-item\b|\bdel\s+\/[sq]\b|\bformat\b)/i;
const SELECTOR_RULE_KIND = 'selector_rule';

const DEFAULT_SAFETY = Object.freeze({
  requiresApproval: true,
  heldOutRequired: true,
  baselineRequired: true,
});

function normalizeArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [...fallback];
}

function cloneObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function safeGenomeId() {
  return `vg_${crypto.randomBytes(9).toString('base64url')}`;
}

function assertSafeName(name) {
  if (typeof name !== 'string' || !SAFE_ID.test(name)) {
    throw new Error(`Unsafe verifier name: ${name || ''}`);
  }
}

function assertSafeCommand(command) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Verifier command must be a non-empty string');
  }
  if (!SAFE_COMMAND_PREFIX.test(command.trim()) || UNSAFE_COMMAND.test(command)) {
    throw new Error(`Unsafe verifier command: ${command}`);
  }
}

function assertSafeTool(tool) {
  if (typeof tool !== 'string' || !SAFE_TOOL.test(tool)) {
    throw new Error(`Unsafe verifier tool: ${tool || ''}`);
  }
}

function normalizeVerifier(verifier = {}) {
  if (!verifier || typeof verifier !== 'object') {
    throw new Error('verifier is required');
  }
  assertSafeName(verifier.name);

  const kind = verifier.kind || 'custom';
  const hasCommand = typeof verifier.command === 'string' && verifier.command.trim();
  const hasTool = typeof verifier.tool === 'string' && verifier.tool.trim();

  if (kind === SELECTOR_RULE_KIND) {
    if (hasCommand || hasTool) {
      throw new Error('Selector-rule verifier genomes cannot define command or tool');
    }
  } else if (hasCommand === hasTool) {
    throw new Error(`Verifier "${verifier.name}" must define exactly one of command or tool`);
  }

  if (hasCommand) assertSafeCommand(verifier.command);
  if (hasTool) assertSafeTool(verifier.tool);

  return {
    name: verifier.name,
    kind,
    command: hasCommand ? verifier.command.trim() : null,
    tool: hasTool ? verifier.tool.trim() : null,
    appliesTo: normalizeArray(verifier.appliesTo, ['**/*']),
    tags: normalizeArray(verifier.tags),
    rubric: cloneObject(verifier.rubric),
    thresholds: cloneObject(verifier.thresholds),
    timeoutMs: Number.isFinite(verifier.timeoutMs) ? verifier.timeoutMs : 120000,
    budget: cloneObject(verifier.budget),
  };
}

function normalizeSafety(safety = {}) {
  return {
    requiresApproval: safety.requiresApproval !== false,
    heldOutRequired: safety.heldOutRequired !== false,
    baselineRequired: safety.baselineRequired !== false,
  };
}

function assertGenomeId(genomeId) {
  if (typeof genomeId !== 'string' || !/^vg_[A-Za-z0-9_-]+$/.test(genomeId)) {
    throw new Error(`Unsafe verifier genome id: ${genomeId || ''}`);
  }
}

export function validateVerifierGenome(genome) {
  try {
    if (!genome || typeof genome !== 'object') throw new Error('genome is required');
    assertGenomeId(genome.genomeId);
    normalizeVerifier(genome.verifier);
    const safety = normalizeSafety(genome.safety);
    if (!safety.requiresApproval || !safety.heldOutRequired || !safety.baselineRequired) {
      throw new Error('Verifier genomes must preserve approval, held-out, and baseline safety gates');
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error.message] };
  }
}

export function createVerifierGenome({ verifier, parentId = null, mutation = {} } = {}) {
  const genome = {
    genomeId: safeGenomeId(),
    parentId,
    verifier: normalizeVerifier(verifier),
    mutation: cloneObject(mutation),
    safety: { ...DEFAULT_SAFETY },
  };
  const validation = validateVerifierGenome(genome);
  if (!validation.valid) throw new Error(validation.errors[0]);
  return genome;
}

export function mutateVerifierGenome({ genome, mutationPolicy = {}, rng = Math.random } = {}) {
  const validation = validateVerifierGenome(genome);
  if (!validation.valid) throw new Error(validation.errors[0]);

  const sourceVerifier = genome.verifier;
  const nextVerifier = {
    ...sourceVerifier,
    appliesTo: normalizeArray(mutationPolicy.appliesTo, sourceVerifier.appliesTo),
    tags: normalizeArray(mutationPolicy.tags, sourceVerifier.tags),
    rubric: {
      ...sourceVerifier.rubric,
      ...cloneObject(mutationPolicy.rubric),
    },
    thresholds: {
      ...sourceVerifier.thresholds,
      ...cloneObject(mutationPolicy.thresholds),
    },
    budget: {
      ...sourceVerifier.budget,
      ...cloneObject(mutationPolicy.budget),
    },
    timeoutMs: Number.isFinite(mutationPolicy.timeoutMs)
      ? mutationPolicy.timeoutMs
      : sourceVerifier.timeoutMs,
  };

  const mutation = {
    ...cloneObject(mutationPolicy.mutation),
    rngSample: Number(rng()).toFixed(6),
  };

  return createVerifierGenome({
    verifier: nextVerifier,
    parentId: genome.genomeId,
    mutation,
  });
}

export function verifierFromGenome(genome) {
  const validation = validateVerifierGenome(genome);
  if (!validation.valid) throw new Error(validation.errors[0]);
  return normalizeVerifier(genome.verifier);
}
