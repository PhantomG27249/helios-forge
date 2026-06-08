import { classifyHarnessFailure } from './errorTaxonomy.js';

function stableStringify(value) {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`;
}

function resultSignature(result = {}) {
  return [
    result.name || result.toolName || 'unknown_tool',
    result.status || 'unknown_status',
    result.reason || '',
    result.error || '',
    stableStringify(result.args || {}),
  ].join('|');
}

export class NoProgressDetector {
  constructor({ threshold = 3 } = {}) {
    this.threshold = threshold;
    this.signatures = new Map();
  }

  record(signature, detail = {}) {
    const count = (this.signatures.get(signature) || 0) + 1;
    this.signatures.set(signature, count);
    const noProgress = count >= this.threshold;
    const repeatedFailure = classifyHarnessFailure({ category: 'repeated_tool_failure' });

    return {
      category: noProgress ? 'no_progress' : null,
      noProgress,
      signature,
      count,
      threshold: this.threshold,
      repeatedFailure,
      detail,
    };
  }

  recordToolResult(result = {}) {
    if (!['blocked', 'failed', 'timeout'].includes(result.status)) {
      return {
        category: null,
        noProgress: false,
        signature: resultSignature(result),
        count: 0,
        threshold: this.threshold,
        repeatedFailure: classifyHarnessFailure({ category: 'repeated_tool_failure' }),
        detail: { result },
      };
    }

    return this.record(resultSignature(result), { result });
  }

  reset(signature) {
    if (signature) {
      this.signatures.delete(signature);
      return;
    }
    this.signatures.clear();
  }
}
