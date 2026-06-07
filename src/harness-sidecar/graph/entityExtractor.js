function slug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function pushUnique(entities, entity) {
  if (!entity.id || entities.some((candidate) => candidate.id === entity.id)) {
    return;
  }
  entities.push(entity);
}

function entityId(type, value) {
  return `${type}:${value}`;
}

export function extractEntities(input = {}) {
  const entities = [];

  for (const path of normalizeArray(input.files)) {
    pushUnique(entities, { id: entityId('file', path), type: 'file', label: path, path });
  }

  for (const path of normalizeArray(input.tests)) {
    pushUnique(entities, { id: entityId('test', path), type: 'test', label: path, path });
  }

  for (const failure of normalizeArray(input.failures)) {
    const text = failure.text || failure.summary || failure.id || failure;
    pushUnique(entities, { id: entityId('failure', failure.id || slug(text)), type: 'failure', label: text });
  }

  for (const claim of normalizeArray(input.claims)) {
    const text = claim.text || claim.summary || claim.id || claim;
    pushUnique(entities, { id: entityId('claim', claim.id || slug(text)), type: 'claim', label: text });
  }

  for (const run of normalizeArray(input.runs)) {
    const runId = run.id || run.runId || run;
    pushUnique(entities, { id: entityId('run', runId), type: 'run', label: run.summary || runId });
  }

  for (const metric of normalizeArray(input.metrics)) {
    const name = metric.name || metric.id || metric;
    pushUnique(entities, { id: entityId('metric', name), type: 'metric', label: name, value: metric.value });
  }

  for (const artifact of normalizeArray(input.artifacts)) {
    const path = artifact.path || artifact.id || artifact;
    pushUnique(entities, { id: entityId('artifact', path), type: 'artifact', label: artifact.label || path, path });
  }

  const text = String(input.text || '');
  for (const match of text.matchAll(/\bClaim:\s*([^.\n]+)/gi)) {
    const label = match[1].trim();
    pushUnique(entities, { id: entityId('claim', slug(label)), type: 'claim', label });
  }
  for (const match of text.matchAll(/\bFailure:\s*([^.\n]+)/gi)) {
    const label = match[1].trim();
    pushUnique(entities, { id: entityId('failure', slug(label)), type: 'failure', label });
  }
  for (const match of text.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|\bclass\s+([A-Za-z_$][\w$]*)/g)) {
    const label = match[1] || match[2];
    pushUnique(entities, { id: entityId('symbol', label), type: 'symbol', label });
  }

  return entities;
}
