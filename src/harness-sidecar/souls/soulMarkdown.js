const SOUL_SECTIONS = [
  'Identity',
  'Mission',
  'Temperament',
  'Values And Invariants',
  'Capability Affinities',
  'Risk Posture',
  'Memory Anchors',
  'Evolution Genome',
  'Evaluation History',
  'Prompt Adapter Notes',
];

const OVERSOUL_SECTIONS = [
  'Identity',
  'Collective Mission',
  'Shared Values And Invariants',
  'Role Ecology',
  'Strategy Posture',
  'Mutation Policy',
  'Collective Memory Anchors',
  'Governance Posture',
  'Evaluation Summary',
  'Prompt Adapter Notes',
];

function parseHeading(markdown) {
  const match = String(markdown || '').match(/^#\s+(Soul|Oversoul):\s*([A-Za-z0-9_-]+)\s*$/m);
  if (!match) {
    throw new Error('Missing required soul or oversoul heading');
  }
  return {
    kind: match[1] === 'Soul' ? 'soul' : 'oversoul',
    id: match[2],
  };
}

function parseSections(markdown) {
  const sections = {};
  const sectionPattern = /^##\s+(.+?)\s*$/gm;
  const matches = [...String(markdown || '').matchAll(sectionPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const title = matches[index][1].trim();
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    sections[title] = markdown.slice(start, end).trim();
  }
  return sections;
}

function requiredSectionsFor(kind) {
  return kind === 'soul' ? SOUL_SECTIONS : OVERSOUL_SECTIONS;
}

function extractVersion(identitySection) {
  const match = String(identitySection || '').match(/^\s*-\s*Version:\s*(.+?)\s*$/mi);
  return match?.[1]?.trim() || null;
}

function assertStrictSections({ kind, sections }) {
  const required = requiredSectionsFor(kind);
  const allowed = new Set(required);

  for (const section of required) {
    if (!sections[section]) {
      throw new Error(`Missing required ${kind} section: ${section}`);
    }
  }

  for (const section of Object.keys(sections)) {
    if (!allowed.has(section)) {
      throw new Error(`Unexpected ${kind} section: ${section}`);
    }
  }
}

export function sanitizePromptAdapterNotes(notes, { maxChars = 800 } = {}) {
  const text = String(notes || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

  const cleaned = text
    .split('\n')
    .map((line) => line
      .replace(/\b(authorization)\s*:\s*bearer\s+\S+/gi, '')
      .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, '')
      .replace(/[A-Za-z]:\\[^\s)>\]]+/g, '')
      .replace(/(?:^|\s)\/(?:Users|home|tmp|var|etc)\/[^\s)>\]]+/g, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/\b(script|iframe|style|onerror|onclick)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  return cleaned.slice(0, Math.max(0, maxChars));
}

export function parseSoulMarkdown(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('soul markdown is required');
  }

  const heading = parseHeading(markdown);
  const sections = parseSections(markdown);
  assertStrictSections({ kind: heading.kind, sections });

  const version = extractVersion(sections.Identity);
  if (!version) {
    throw new Error(`Missing required ${heading.kind} identity field: Version`);
  }

  return {
    kind: heading.kind,
    id: heading.id,
    version,
    sections,
    promptAdapterNotes: sanitizePromptAdapterNotes(sections['Prompt Adapter Notes']),
  };
}

