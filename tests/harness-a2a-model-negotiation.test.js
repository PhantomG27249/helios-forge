import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  A2AEndpointRegistry,
  buildA2ANegotiationResponseEnvelope,
} from '../src/harness-sidecar/interop/a2aEndpointRegistry.js';
import { buildSwarmA2AEnvelope } from '../src/harness-sidecar/interop/a2aSwarmEnvelope.js';
import { ExternalAgentGateway } from '../src/harness-sidecar/interop/externalAgentGateway.js';

test('A2A endpoint registry normalizes model capabilities and discovers peers by role and model fit', () => {
  const registry = new A2AEndpointRegistry({
    endpoints: [
      {
        id: 'peer-reviewer',
        name: 'Reviewer Peer',
        protocol: 'a2a',
        endpoint: {
          url: 'https://reviewer.example.test/a2a',
          headers: { Authorization: 'Bearer must-not-cross' },
        },
        capabilities: ['review.code'],
        trustLevel: 'verified',
        modelCapabilities: {
          profiles: ['critic_low_temp', 'critic_low_temp', ''],
          supportsVision: false,
          maxContextTokens: 65_536,
          costTier: 'low',
          latencyTier: 'fast',
          preferredRoles: ['reviewer', 'risk-auditor'],
          unavailableProfiles: ['vision_heavy'],
          apiKey: 'sk-must-not-cross',
        },
      },
      {
        id: 'peer-vision',
        name: 'Vision Peer',
        protocol: 'a2a',
        endpoint: { url: 'https://vision.example.test/a2a' },
        capabilities: ['review.code'],
        trustLevel: 'verified',
        modelCapabilities: {
          profiles: ['vision_heavy'],
          supportsVision: true,
          maxContextTokens: 16_384,
          costTier: 'high',
          latencyTier: 'slow',
          preferredRoles: ['visual-verifier'],
        },
      },
    ],
  });

  const reviewer = registry.describeEndpoint('peer-reviewer');
  assert.deepEqual(reviewer.modelCapabilities, {
    profiles: ['critic_low_temp'],
    supportsVision: false,
    maxContextTokens: 65_536,
    costTier: 'low',
    latencyTier: 'fast',
    preferredRoles: ['reviewer', 'risk-auditor'],
    unavailableProfiles: ['vision_heavy'],
  });
  assert.equal(JSON.stringify(reviewer).includes('must-not-cross'), false);

  const matches = registry.discover({
    capabilities: ['review.code'],
    minTrustLevel: 'verified',
    role: 'reviewer',
    modelCapability: {
      profiles: ['critic_low_temp'],
      minContextTokens: 32_768,
      costTier: 'low',
    },
  });

  assert.deepEqual(matches.map((peer) => peer.id), ['peer-reviewer']);
});

test('A2A negotiation envelopes carry evidence-only model preferences and responses', () => {
  const registry = new A2AEndpointRegistry({
    now: () => 8_000,
    endpoints: [{
      id: 'peer-reviewer',
      name: 'Reviewer Peer',
      protocol: 'a2a',
      endpoint: { url: 'https://reviewer.example.test/a2a' },
      capabilities: ['review.code'],
      trustLevel: 'verified',
      modelCapabilities: {
        profiles: ['critic_low_temp', 'general_fast'],
        maxContextTokens: 65_536,
        preferredRoles: ['reviewer'],
      },
    }],
  });

  const request = registry.buildNegotiationEnvelope({
    toAgentId: 'peer-reviewer',
    task: {
      id: 'task-model-negotiation',
      taskType: 'code-review',
      requiredCapabilities: ['review.code'],
    },
    modelPreference: {
      role: 'reviewer',
      taskType: 'code-review',
      preferredProfiles: ['critic_low_temp'],
      excludedProfiles: ['general_fast'],
      requiredCapabilities: {
        minContextTokens: 32_000,
      },
      apiKey: 'sk-must-not-cross',
    },
  });

  assert.deepEqual(request.message.modelPreference, {
    role: 'reviewer',
    taskType: 'code-review',
    preferredProfiles: ['critic_low_temp'],
    excludedProfiles: ['general_fast'],
    requiredCapabilities: {
      minContextTokens: 32_000,
    },
    authority: 'evidence_only',
    canPromote: false,
  });
  assert.equal(JSON.stringify(request).includes('sk-must-not-cross'), false);

  const response = buildA2ANegotiationResponseEnvelope({
    from: 'peer-reviewer',
    accepted: true,
    acceptedCapabilities: ['review.code'],
    modelNegotiation: {
      acceptedProfile: 'critic_low_temp',
      fallbackProfiles: ['general_fast'],
      reasons: ['role_preferred', 'context_window_sufficient'],
      canPromote: true,
    },
    requestEnvelope: request,
  });

  assert.deepEqual(response.message.modelNegotiation, {
    acceptedProfile: 'critic_low_temp',
    fallbackProfiles: ['general_fast'],
    reasons: ['role_preferred', 'context_window_sufficient'],
    authority: 'evidence_only',
    canPromote: false,
  });
});

test('A2A swarm envelopes preserve negotiated external model routes without local authority', () => {
  const envelope = buildSwarmA2AEnvelope({
    from: 'helios.sidecar',
    to: 'peer-reviewer',
    task: { id: 'task-swarm-route', task: 'Review the candidate.' },
    attempt: { id: 'attempt-swarm-route' },
    role: 'reviewer',
    modelRoute: {
      source: 'a2a_negotiation',
      peerId: 'peer-reviewer',
      role: 'reviewer',
      modelProfile: 'critic_low_temp',
      endpointProfile: 'peer-reviewer:a2a',
      external: false,
      verified: true,
      authority: 'trusted',
      canPromote: true,
      token: 'sk-must-not-cross',
    },
  });

  assert.deepEqual(envelope.message.a2a.modelRoute, {
    source: 'a2a_negotiation',
    peerId: 'peer-reviewer',
    role: 'reviewer',
    modelProfile: 'critic_low_temp',
    endpointProfile: 'peer-reviewer:a2a',
    external: true,
    verified: false,
    authority: 'evidence_only',
    canPromote: false,
  });
  assert.equal(JSON.stringify(envelope).includes('sk-must-not-cross'), false);
});

test('external delegated model routes can inform rewards but cannot grant mutation authority', async () => {
  const gateway = new ExternalAgentGateway({
    agents: [{
      id: 'peer-reviewer',
      name: 'Reviewer Peer',
      protocol: 'a2a',
      endpoint: { url: 'https://reviewer.example.test/a2a' },
      capabilities: ['patch.apply'],
      trustLevel: 'verified',
    }],
  });

  const envelope = gateway.buildEnvelope({
    agentId: 'peer-reviewer',
    grantedCapabilities: ['patch.apply'],
    task: {
      id: 'task-external-route',
      mutation: true,
      requiredCapabilities: ['patch.apply'],
      context: {
        a2a: {
          modelRoute: {
            source: 'a2a_negotiation',
            peerId: 'peer-reviewer',
            role: 'reviewer',
            modelProfile: 'critic_low_temp',
            endpointProfile: 'peer-reviewer:a2a',
            canPromote: true,
            verified: true,
          },
        },
      },
    },
  });

  assert.equal(envelope.task.context.a2a.modelRoute.external, true);
  assert.equal(envelope.task.context.a2a.modelRoute.verified, false);
  assert.equal(envelope.task.context.a2a.modelRoute.authority, 'evidence_only');
  assert.equal(envelope.task.context.a2a.modelRoute.canPromote, false);

  const blocked = await gateway.dispatchTask({
    agentId: 'peer-reviewer',
    task: {
      id: 'task-external-route',
      mutation: true,
      requiredCapabilities: ['patch.apply'],
      context: {
        a2a: {
          modelRoute: envelope.task.context.a2a.modelRoute,
        },
      },
    },
  });

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'mutation_requires_approval');
});
