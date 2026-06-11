const REDACTED = '[redacted]';
const REDACTED_PATH = '[redacted:path]';

const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|credential|password|passwd|private|secret|token)/i;
const SECRET_TEXT_PATTERNS = [
  /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]+/g,
  /(^|[^A-Za-z0-9])gh[pousr]_[A-Za-z0-9_-]+/g,
  /(^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9_-]+/gi,
  /(^|[^A-Za-z0-9])bearer\s+[A-Za-z0-9._-]+/gi,
  /\b(password|passwd|token|secret|credential|authorization|api[_-]?key|[A-Z0-9_]*API[_-]?KEY)\s*[:=]\s*[^\s,;'"<>]+/gi,
];
const WINDOWS_ABSOLUTE_PATH_PATTERN = /(^|[\s([{])(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;
const UNIX_ABSOLUTE_PATH_PATTERN = /(^|[\s([{])\/(?:bin|dev|etc|home|mnt|opt|private|root|sbin|tmp|usr|Users|var)(?:\/|$)[^\s,;'"<>]*/i;
const UNIX_PATH_LIKE_VALUE_PATTERN = /^\/(?!\/)/;
const TRAVERSAL_PATH_PATTERN = /(^|[\\/])\.\.([\\/]|$)|^\.\.([\\/]|$)/;
const AUTHORITY_KEYS = new Set([
  'apply',
  'approvalauthority',
  'approved',
  'canApply',
  'canMutateWorkspace',
  'canPromote',
  'directApplyAllowed',
  'durableApplyApproved',
  'promoted',
  'promotionauthority',
  'promotionAllowed',
  'verifierBypass',
]);
const AUTHORITY_STRING_KEYS = new Set([
  'authority',
  'authoritylevel',
  'workspacerewritescope',
  'workspacewritescope',
  'writescope',
]);

function addReason(reasons, reason) {
  reasons.add(reason);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPathLikeKey(key) {
  return /(artifact|dir|directory|file|fixture|path|root|source)/.test(normalizeKey(key));
}

function isUnsafePathString(value, key = '') {
  return WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
    || UNIX_ABSOLUTE_PATH_PATTERN.test(value)
    || (isPathLikeKey(key) && UNIX_PATH_LIKE_VALUE_PATTERN.test(value))
    || TRAVERSAL_PATH_PATTERN.test(value);
}

function normalizeKey(key) {
  return String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function isAuthorityBooleanKey(key) {
  const normalized = normalizeKey(key);
  return AUTHORITY_KEYS.has(key)
    || AUTHORITY_KEYS.has(normalized)
    || (
      /(apply|approval|approved|promote|promotion|mutateworkspace|verifierbypass)/.test(normalized)
      && /(allow|allowed|authority|approved|can|durable|bypass)/.test(normalized)
    );
}

function isAuthorityStringKey(key) {
  return AUTHORITY_STRING_KEYS.has(normalizeKey(key));
}

function safeAuthorityStringValue(key) {
  const normalized = normalizeKey(key);
  if (normalized.includes('writescope')) return 'none';
  return 'evidence_only';
}

function redactSecretText(value, reasons) {
  let redacted = value;
  for (const pattern of SECRET_TEXT_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefixOrKey) => {
      addReason(reasons, 'secret_like_value');
      if (/^(password|passwd|token|secret|credential|authorization|api[_-]?key|[A-Z0-9_]*API[_-]?KEY)$/i.test(prefixOrKey)) {
        return `${prefixOrKey}=${REDACTED}`;
      }
      return `${prefixOrKey || ''}${REDACTED}`;
    });
  }
  return redacted;
}

function truncateText(value, reasons, maxStringLength) {
  if (value.length <= maxStringLength) return value;
  addReason(reasons, 'oversize_text_value');
  return `${value.slice(0, Math.max(0, maxStringLength))} [truncated]`;
}

function sanitizeValue(value, keyPath, context) {
  const key = keyPath.at(-1) || '';
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(key)) {
      addReason(context.reasons, 'secret_like_value');
      return REDACTED;
    }
    if (isUnsafePathString(value, key)) {
      addReason(context.reasons, 'unsafe_path_value');
      return REDACTED_PATH;
    }
    return truncateText(redactSecretText(value, context.reasons), context.reasons, context.maxStringLength);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, [...keyPath, String(index)], context));
  }

  if (!isPlainObject(value)) return value;

  const sanitized = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (isAuthorityBooleanKey(childKey) && childValue === true) {
      sanitized[childKey] = false;
      addReason(context.reasons, 'authority_claim_removed');
      continue;
    }
    if (isAuthorityStringKey(childKey) && typeof childValue === 'string' && !['advisory', 'evidence_only', 'none'].includes(childValue)) {
      sanitized[childKey] = safeAuthorityStringValue(childKey);
      addReason(context.reasons, 'authority_claim_removed');
      continue;
    }

    sanitized[childKey] = sanitizeValue(childValue, [...keyPath, childKey], context);
  }

  if (sanitized.external === true && sanitized.verified === true) {
    sanitized.verified = false;
    addReason(context.reasons, 'external_verification_escalation');
  }

  return sanitized;
}

export function quarantineModelVisiblePayload(value, options = {}) {
  const context = {
    maxStringLength: Number.isFinite(options.maxStringLength) ? Math.max(0, options.maxStringLength) : 4000,
    reasons: new Set(),
  };
  const sanitized = sanitizeValue(value, [], context);
  const reasons = [...context.reasons].sort();

  return {
    value: sanitized,
    quarantined: reasons.length > 0,
    reasons,
    redacted: reasons.includes('secret_like_value') || reasons.includes('unsafe_path_value'),
  };
}

export function redactModelVisibleValue(value, options = {}) {
  return quarantineModelVisiblePayload(value, options).value;
}
