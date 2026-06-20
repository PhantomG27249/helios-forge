export function applyFullEvolutionProfile(harnessConfig = {}) {
  const config = structuredClone(harnessConfig);
  config.features = {
    ...(config.features || {}),
    skillEvolution: true,
    localMetaHarness: true,
    localMemoryGraph: true,
    swarm: true,
    deepResearch: config.features?.deepResearch !== false,
    icr: {
      ...(config.features?.icr || {}),
      enabled: true,
    },
  };
  config.icr = {
    ...(config.icr || {}),
    enabled: true,
  };
  config.skillEvolution = {
    ...(config.skillEvolution || {}),
    besLane: true,
  };
  config.evolution = {
    ...(config.evolution || {}),
    promotionOrchestration: true,
    campaignMaxCycles: config.evolution?.campaignMaxCycles ?? 3,
  };
  config.productionCapabilities = {
    ...(config.productionCapabilities || {}),
    operatorDashboards: { enabled: true, evidenceOnly: true },
    sourceTreeVariants: { enabled: true, evidenceOnly: true },
    productionAutonomyPolicy: { enabled: true, evidenceOnly: true },
    modelBackedRhoEmbeddings: { enabled: true, evidenceOnly: true },
    modelAssistedMemory: { enabled: true, evidenceOnly: true },
    modelAssistedBesJudgment: { enabled: true, evidenceOnly: true },
  };
  config.piBridge = {
    ...(config.piBridge || {}),
    contextPackEnabled: true,
    fullLeverageProfile: true,
  };
  return config;
}

export function fullEvolutionProfileActive(harnessConfig = {}) {
  return harnessConfig?.piBridge?.fullLeverageProfile === true
    || harnessConfig?.evolution?.promotionOrchestration === true;
}
