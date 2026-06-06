let experimentCounter = 0;

export function proposeExperiment({ hypothesis, commands = [], budget = {} }) {
  experimentCounter += 1;
  return {
    experimentId: `EXP${String(experimentCounter).padStart(4, '0')}`,
    hypothesis,
    commands,
    budget,
    status: 'approval_required',
    requiresApproval: true,
    createdAt: new Date().toISOString(),
  };
}
