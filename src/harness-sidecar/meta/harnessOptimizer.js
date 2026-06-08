import { generateCandidateChange } from './candidateGenerator.js';
import { BesMetaOptimizer } from './besMetaOptimizer.js';

export class HarnessOptimizer {
  constructor(options = {}) {
    this.mode = options.mode || 'legacy';
    this.options = { ...options };
  }

  propose({ traceSummary, target, candidateRun, coreset, parentCandidates } = {}) {
    if (this.mode === 'bes-rho') {
      return new BesMetaOptimizer(this.options).propose({
        traceSummary,
        target,
        candidateRun,
        coreset,
        parentCandidates,
      });
    }

    const candidate = generateCandidateChange({ traceSummary, target });
    return {
      ...candidate,
      status: 'approval_required',
      applied: false,
      candidateRun,
    };
  }
}
