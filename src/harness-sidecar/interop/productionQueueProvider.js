import { createA2aQueueProvider } from './a2aQueueProvider.js';

function gateFromFeatureFlags(featureFlags = {}) {
  return featureFlags.productionCapabilities?.productionA2aQueues
    || featureFlags.productionA2aQueues
    || {};
}

function assertGateEnabled(featureFlags = {}) {
  const gate = gateFromFeatureFlags(featureFlags);
  if (gate.enabled !== true) {
    throw new Error('production_a2a_queues_disabled');
  }
  return gate;
}

export function createProductionQueueProvider({
  workspaceRoot,
  adapter,
  durableStore,
  featureFlags = {},
} = {}) {
  const gate = gateFromFeatureFlags(featureFlags);
  const provider = createA2aQueueProvider({
    adapter,
    durableStore: durableStore || (workspaceRoot
      ? {
        path: `${workspaceRoot}/.harness/interop/production-queues.json`,
        root: workspaceRoot,
      }
      : undefined),
  });

  function describe() {
    return {
      type: 'production_queue_provider',
      enabled: gate.enabled === true,
      mode: gate.mode || 'offline',
      authority: gate.authority || 'evidence_only',
      durable: Boolean(durableStore || workspaceRoot),
      redacted: true,
      queues: ['outbox', 'inbox', 'streams', 'peerEndpoints'],
    };
  }

  function enqueue(queueName, record = {}) {
    assertGateEnabled(featureFlags);
    return provider.enqueue(queueName, record);
  }

  function ack(args = {}) {
    assertGateEnabled(featureFlags);
    return provider.ack(args);
  }

  return {
    load: provider.load,
    hydrate: provider.hydrate,
    save: provider.save,
    list: provider.list,
    enqueue,
    ack,
    describe,
    toJSON: describe,
    toString: () => '[ProductionQueueProvider redacted]',
  };
}
