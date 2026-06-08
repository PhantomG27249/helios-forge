export const REQUIRED_COMPACTION_FIELDS = [
  'objective',
  'successCriteria',
  'userConstraints',
  'nonGoals',
  'activeFiles',
  'touchedFiles',
  'commandsRun',
  'failingTests',
  'passingTests',
  'decisions',
  'failedAttempts',
  'nextSteps',
  'sourcePointers',
  'unresolvedQuestions',
  'environmentState',
  'riskFlags',
];

const ARRAY_FIELDS = new Set([
  'successCriteria',
  'userConstraints',
  'nonGoals',
  'activeFiles',
  'touchedFiles',
  'commandsRun',
  'failingTests',
  'passingTests',
  'decisions',
  'failedAttempts',
  'nextSteps',
  'sourcePointers',
  'unresolvedQuestions',
  'riskFlags',
]);

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isUnsafePath(value) {
  const text = safeString(value);
  return !text || text.includes('\0') || text.includes('..');
}

export function normalizeSourcePointer(pointer) {
  if (!pointer || typeof pointer !== 'object') return null;
  const path = safeString(pointer.path);
  const eventId = safeString(pointer.eventId);
  if (!path && !eventId) return null;
  if (path && isUnsafePath(path)) return null;

  const normalized = {};
  if (path) normalized.path = path.replaceAll('\\', '/');
  const line = Number(pointer.line);
  if (Number.isInteger(line) && line > 0) normalized.line = line;
  const label = safeString(pointer.label);
  if (label) normalized.label = label;
  if (eventId) normalized.eventId = eventId;
  return normalized;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
}

export function createEmptyCompactionArtifact(overrides = {}) {
  const artifact = {
    objective: null,
    successCriteria: [],
    userConstraints: [],
    nonGoals: [],
    activeFiles: [],
    touchedFiles: [],
    commandsRun: [],
    failingTests: [],
    passingTests: [],
    decisions: [],
    failedAttempts: [],
    nextSteps: [],
    sourcePointers: [],
    unresolvedQuestions: [],
    environmentState: {},
    riskFlags: [],
    ...overrides,
  };

  for (const field of ARRAY_FIELDS) {
    artifact[field] = normalizeArray(artifact[field]);
  }
  artifact.sourcePointers = artifact.sourcePointers
    .map(normalizeSourcePointer)
    .filter(Boolean);
  artifact.environmentState = artifact.environmentState && typeof artifact.environmentState === 'object'
    ? { ...artifact.environmentState }
    : {};
  return artifact;
}

export function validateCompactionArtifact(artifact = {}) {
  const missingFields = REQUIRED_COMPACTION_FIELDS.filter((field) => !Object.hasOwn(artifact, field));
  const invalidFields = [];
  for (const field of ARRAY_FIELDS) {
    if (Object.hasOwn(artifact, field) && !Array.isArray(artifact[field])) {
      invalidFields.push(field);
    }
  }
  if (
    Object.hasOwn(artifact, 'environmentState')
    && (artifact.environmentState === null || typeof artifact.environmentState !== 'object' || Array.isArray(artifact.environmentState))
  ) {
    invalidFields.push('environmentState');
  }

  return {
    valid: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields,
  };
}

function recordForItem(item) {
  const base = {};
  if (item.id) base.id = item.id;
  if (item.path) base.path = item.path;
  if (item.command) base.command = item.command;
  if (item.content) base.content = item.content;
  if (item.summary) base.summary = item.summary;
  return base;
}

export function mergeItemIntoArtifact(artifact, item = {}) {
  const pointer = normalizeSourcePointer(item.sourcePointer || item.source || item);
  if (pointer && !artifact.sourcePointers.some((existing) => JSON.stringify(existing) === JSON.stringify(pointer))) {
    artifact.sourcePointers.push(pointer);
  }
  const record = recordForItem(item);
  if (item.type === 'user_constraint') artifact.userConstraints.push(record);
  if (item.type === 'active_file') artifact.activeFiles.push(record);
  if (item.type === 'touched_file') artifact.touchedFiles.push(record);
  if (item.type === 'command') artifact.commandsRun.push(record);
  if (item.type === 'failing_test') artifact.failingTests.push(record);
  if (item.type === 'passing_test') artifact.passingTests.push(record);
  if (item.type === 'decision') artifact.decisions.push(record);
  if (item.type === 'failed_attempt') artifact.failedAttempts.push(record);
  if (item.type === 'next_step') artifact.nextSteps.push(record);
  if (item.type === 'risk') artifact.riskFlags.push(record);
  return artifact;
}
