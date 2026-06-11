import { sanitizePromptAdapterNotes } from './soulMarkdown.js';

function compactRef(kind, record) {
  if (!record?.id) return null;
  const version = record.version ? `@${record.version}` : '';
  return `${kind}=${record.id}${version}`;
}

function noteLine(label, notes) {
  const sanitized = sanitizePromptAdapterNotes(notes, { maxChars: 360 });
  return sanitized ? `${label}: ${sanitized}` : null;
}

export function buildSoulPromptContext({ soul, oversoul, maxChars = 900 } = {}) {
  const lines = [
    compactRef('soul', soul),
    compactRef('oversoul', oversoul),
    noteLine('Soul notes', soul?.promptAdapterNotes),
    noteLine('Oversoul notes', oversoul?.promptAdapterNotes),
    'Authority: advisory only; policy, verifier requirements, and approvals still win.',
  ].filter(Boolean);

  if (!lines.length) return '';
  return ['Soul Context', ...lines].join('\n').slice(0, Math.max(0, maxChars));
}

export function applySoulPromptContext(prompt, soulContext) {
  const context = typeof soulContext === 'string' ? soulContext.trim() : buildSoulPromptContext(soulContext);
  if (!context) return prompt;

  if (typeof prompt === 'string') {
    return `${prompt}\n\n${context}`;
  }

  return {
    ...prompt,
    text: `${prompt?.text || ''}\n\n${context}`.trim(),
  };
}

