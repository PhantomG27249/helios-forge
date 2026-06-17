(function initHarnessConfigUiSchema(global) {
  const GATE_MODES = ['offline', 'advisory', 'active'];

  const PRODUCTION_CAPABILITY_GATES = [
    ['operatorDashboards', 'Operator dashboards & replay'],
    ['sourceTreeVariants', 'Source-tree variant campaigns'],
    ['modelBackedRhoEmbeddings', 'RHO embeddings at scale'],
    ['modelAssistedBesJudgment', 'Model-assisted BES judgment'],
    ['modelAssistedMemory', 'Model-assisted memory graph'],
    ['visualSwarmCell', 'Visual swarm cell'],
    ['visualReplaySuites', 'Visual replay suites'],
    ['productionA2aTransport', 'A2A transport'],
    ['productionA2aQueues', 'A2A durable queues'],
    ['councilDebate', 'Council debate evidence'],
    ['ensembleCalibration', 'Ensemble calibration'],
    ['endpointCapacityRecommendations', 'Endpoint capacity recommendations'],
    ['backgroundEvolution', 'Background evolution ticks'],
    ['productionAutonomyPolicy', 'Production autonomy policy'],
    ['icrLane', 'ICR test-time compute lane'],
  ];

  const FEATURE_TOGGLES = [
    ['swarm', 'Swarm'],
    ['modelDrivenSwarm', 'Model-driven swarm'],
    ['piNativeSwarm', 'Pi-native swarm'],
    ['multiModelSwarm', 'Multi-model swarm'],
    ['adaptiveModelRouter', 'Adaptive model router'],
    ['autonomousToolLoop', 'Autonomous tool loop'],
    ['worktreeSwarm', 'Worktree swarm'],
    ['deepResearch', 'Deep research'],
    ['experiments', 'Experiments'],
    ['visualArtifacts', 'Visual artifacts'],
    ['adaptiveSearch', 'Adaptive search'],
    ['verifierEvolution', 'Verifier evolution'],
    ['safeApply', 'Safe apply'],
    ['localMemoryGraph', 'Local memory graph'],
    ['nestedSwarmCells', 'Nested swarm cells'],
    ['backgroundEvolution', 'Background evolution (feature flag)'],
  ];

  global.HELIOS_HARNESS_CONFIG_UI = {
    GATE_MODES,
    PRODUCTION_CAPABILITY_GATES,
    FEATURE_TOGGLES,
    sections: {
      general: {
        title: 'General & budgets',
        fields: [
          { path: ['project', 'name'], label: 'Project name', type: 'text' },
          { path: ['defaults', 'modelProfile'], label: 'Default model profile', type: 'modelProfile' },
          { path: ['defaults', 'contextProfile'], label: 'Context profile', type: 'text' },
          { path: ['defaults', 'swarmModelProfile'], label: 'Swarm model profile', type: 'modelProfile' },
          { path: ['defaults', 'vlmModelProfile'], label: 'VLM model profile', type: 'modelProfile' },
          { path: ['budgets', 'maxToolCalls'], label: 'Max tool calls', type: 'number', min: 1, max: 256 },
          { path: ['budgets', 'maxWallMinutes'], label: 'Max wall minutes', type: 'number', min: 1, max: 480 },
          {
            path: ['permissions', 'allowedTools'],
            label: 'Allowed tools (comma-separated)',
            type: 'csv',
            hint: 'Leave empty to use permission mode defaults.',
          },
          {
            path: ['permissions', 'riskyTools'],
            label: 'Risky tools (comma-separated)',
            type: 'csv',
          },
          { path: ['models', 'swarmBaseUrl'], label: 'Swarm model base URL', type: 'text', mono: true },
          { path: ['models', 'swarmModelId'], label: 'Swarm model ID', type: 'text', mono: true },
          { path: ['models', 'swarmSupportsVision'], label: 'Swarm supports vision', type: 'checkbox' },
          {
            path: ['permissions', 'mode'],
            label: 'Permission mode',
            type: 'select',
            options: [
              ['safe_edit', 'safe_edit'],
              ['read_only', 'read_only'],
              ['full', 'full'],
            ],
          },
        ],
      },
      runtime: {
        title: 'Runtime & health',
        fields: [
          { path: ['vllmHealth', 'enabled'], label: 'vLLM health probing', type: 'checkbox' },
          { path: ['vllmHealth', 'minConcurrency'], label: 'Min concurrency', type: 'number', min: 1, max: 64 },
          { path: ['vllmHealth', 'maxConcurrency'], label: 'Max concurrency', type: 'number', min: 1, max: 64 },
          { path: ['vllmHealth', 'initialConcurrency'], label: 'Initial concurrency', type: 'number', min: 1, max: 64 },
          { path: ['vllmHealth', 'probeConcurrency'], label: 'Probe concurrency', type: 'number', min: 1, max: 64 },
          { path: ['vllmHealth', 'timeoutMs'], label: 'Health timeout (ms)', type: 'number', min: 500, max: 120000 },
          { path: ['vllmHealth', 'targetLatencyMs'], label: 'Target latency (ms)', type: 'number', min: 100, max: 120000 },
          { path: ['backgroundEvolution', 'intervalMs'], label: 'Background tick interval (ms)', type: 'number', min: 30000, max: 3600000 },
          { path: ['partialAutonomy', 'enabled'], label: 'Partial autonomy apply', type: 'checkbox' },
          { path: ['partialAutonomy', 'thresholds', 'minReplayCycles'], label: 'Min replay cycles (partial autonomy)', type: 'number', min: 0, max: 100 },
          { path: ['partialAutonomy', 'thresholds', 'minRollbackDrills'], label: 'Min rollback drills (partial autonomy)', type: 'number', min: 0, max: 100 },
        ],
      },
      councilAdvanced: {
        title: 'Council advanced',
        fields: [
          {
            path: ['modelCouncil', 'mode'],
            label: 'Council mode',
            type: 'select',
            options: [['advisory', 'advisory'], ['active', 'active'], ['off', 'off']],
          },
          { path: ['modelCouncil', 'diversityRequired'], label: 'Diversity required', type: 'number', min: 1, max: 16 },
          { path: ['modelCouncil', 'disagreementThreshold'], label: 'Disagreement threshold', type: 'number', min: 0, max: 1, step: 0.05 },
        ],
      },
      routerAdvanced: {
        title: 'Router advanced',
        fields: [
          {
            path: ['modelRouter', 'mode'],
            label: 'Router mode',
            type: 'select',
            options: [['advisory', 'advisory'], ['active', 'active'], ['off', 'off']],
          },
          { path: ['modelRouter', 'minEvidencePerArm'], label: 'Min evidence per arm', type: 'number', min: 1, max: 100 },
          { path: ['modelRouter', 'explorationFloor'], label: 'Exploration floor', type: 'number', min: 0, max: 1, step: 0.01 },
          { path: ['modelRouter', 'maxArmsPerDecision'], label: 'Max arms per decision', type: 'number', min: 1, max: 32 },
          { path: ['modelRouter', 'persistence', 'enabled'], label: 'Persist router state', type: 'checkbox' },
          { path: ['modelRouter', 'persistence', 'path'], label: 'Router state path', type: 'text', mono: true },
        ],
      },
      icr: {
        title: 'ICR lane',
        fields: [
          { path: ['icr', 'enabled'], label: 'Enable ICR lane', type: 'checkbox' },
          { path: ['icr', 'persistOnTask'], label: 'Persist ICR evidence on task', type: 'checkbox' },
          { path: ['icr', 'includeRhoComparison'], label: 'Include RHO comparison', type: 'checkbox' },
          { path: ['icr', 'branchBreadth'], label: 'Branch breadth', type: 'number', min: 1, max: 16 },
          { path: ['icr', 'correctionDepth'], label: 'Correction depth', type: 'number', min: 1, max: 32 },
          { path: ['icr', 'solutionPoolSize'], label: 'Solution pool size', type: 'number', min: 1, max: 32 },
          { path: ['icr', 'maxComputeMultiplier'], label: 'Max compute multiplier', type: 'number', min: 1, max: 200 },
          { path: ['icr', 'maxContextTokens'], label: 'Max context tokens', type: 'number', min: 1000, max: 2000000 },
        ],
      },
    },
  };
}(window));
