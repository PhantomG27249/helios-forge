import { generateCandidateChange } from './candidateGenerator.js';
import { BesMetaOptimizer } from './besMetaOptimizer.js';
import { proposeCompactionPolicies } from './compactionPolicyEvolution.js';
import { proposeModelRoutingPolicies } from './modelRoutingPolicyEvolution.js';

export class HarnessOptimizer {
  constructor(options = {}) {
    this.mode = options.mode || 'legacy';
    this.options = { ...options };
  }

  propose({ traceSummary, target, candidateRun, coreset, parentCandidates } = {}) {
    if (target === 'model_routing_policy' && (this.mode === 'rho-meta' || this.mode === 'bes-rho')) {
      const candidates = proposeModelRoutingPolicies({
        coreset,
        baselinePolicy: this.options.modelRoutingPolicy || this.options.baselinePolicy || {},
        routerState: this.options.routerState,
        maxCandidates: this.options.maxCandidates,
      });
      return {
        candidates,
        coreset,
        target: 'model_routing_policy',
      };
    }

    if (target === 'compaction_policy' && (this.mode === 'rho-meta' || this.mode === 'bes-rho')) {
      const candidates = proposeCompactionPolicies({
        coreset,
        baselinePolicy: this.options.compactionPolicy || {},
        maxCandidates: this.options.maxCandidates,
      });
      return {
        candidates,
        coreset,
        target: 'compaction_policy',
      };
    }

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
