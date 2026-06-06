import { generateCandidateChange } from './candidateGenerator.js';

export class HarnessOptimizer {
  propose({ traceSummary, target, candidateRun }) {
    const candidate = generateCandidateChange({ traceSummary, target });
    return {
      ...candidate,
      status: 'approval_required',
      applied: false,
      candidateRun,
    };
  }
}
