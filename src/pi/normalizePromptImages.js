const DEFAULT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function stripBase64(data) {
  const cleaned = String(data || '').replace(/\s+/g, '');
  if (!cleaned) {
    throw new Error('Image attachment is empty');
  }
  if (!BASE64_RE.test(cleaned)) {
    throw new Error('Image attachment contains invalid base64 characters');
  }
  return cleaned;
}

function parseDataUrl(value) {
  const match = String(value || '').trim().match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: stripBase64(match[2]),
  };
}

export function normalizePromptImage(image) {
  if (typeof image === 'string') {
    const trimmed = image.trim();
    if (!trimmed) return null;

    const parsed = trimmed.startsWith('data:')
      ? parseDataUrl(trimmed)
      : { mimeType: 'image/png', data: stripBase64(trimmed) };

    if (!parsed) return null;
    return {
      type: 'image',
      mimeType: parsed.mimeType,
      data: parsed.data,
    };
  }

  if (!image || typeof image !== 'object') return null;

  const mimeType = image.mimeType
    || (typeof image.type === 'string' && image.type.includes('/') ? image.type : null)
    || 'image/png';
  const raw = image.data || image.base64;
  if (typeof raw !== 'string' || !raw.trim()) return null;

  if (raw.trim().startsWith('data:')) {
    const parsed = parseDataUrl(raw);
    if (!parsed) return null;
    return {
      type: 'image',
      mimeType: parsed.mimeType,
      data: parsed.data,
    };
  }

  return {
    type: 'image',
    mimeType,
    data: stripBase64(raw),
  };
}

export function normalizePromptImages(images, { maxImageBytes = DEFAULT_MAX_IMAGE_BYTES } = {}) {
  if (!Array.isArray(images) || !images.length) return [];

  const normalized = [];
  for (const image of images) {
    const attachment = normalizePromptImage(image);
    if (!attachment) continue;

    const byteLength = Math.ceil((attachment.data.length * 3) / 4);
    if (byteLength > maxImageBytes) {
      throw new Error(`Image attachment exceeds ${maxImageBytes} byte limit (${byteLength} bytes)`);
    }
    normalized.push(attachment);
  }

  return normalized;
}
