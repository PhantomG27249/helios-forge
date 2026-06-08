import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeAgentCard,
  normalizeAgentCards,
} from '../src/harness-sidecar/interop/agentCards.js';
import {
  buildGatewayRequest,
  chooseAgentRoute,
} from '../src/harness-sidecar/interop/agentRouter.js';
import {
  createDelegatedCapabilityToken,
  verifyDelegatedCapabilityToken,
} from '../src/harness-sidecar/interop/delegatedCapabilityTokens.js';
import { ExternalAgentGateway } from '../src/harness-sidecar/interop/externalAgentGateway.js';

test('agent card normalization validates core identity, protocol, and redacts credentials', () => {
  const card = normalizeAgentCard({
    id: 'agent.review-1',
    name: 'Review Agent',
    protocol: 'A2A',
    endpoint: {
      url: 'https://agents.example.test/a2a',
      headers: {
        Authorization: 'Bearer secret-token',
        'X-Trace': 'trace-1',
      },
      apiKey: 'sk-live-secret',
    },
    capabilities: ['code.review', 'repo.search', 'code.review', '  '],
    costModel: {
      currency: 'USD',
      perRequestCost: 0.01,
      perTokenCost: 0.000002,
    },
    latencyStats: {
      p50Ms: 3000,
      p95Ms: 9000,
    },
    trustLevel: 'verified',
    toolPermissions: {
      allowed: ['github.search_issues', 'repo.read'],
      denied: ['shell.exec'],
      env: {
        GITHUB_TOKEN: 'ghp_secret',
        MODE: 'readonly',
      },
    },
    available: true,
  });

  assert.equal(card.id, 'agent.review-1');
  assert.equal(card.protocol, 'a2a');
  assert.deepEqual(card.capabilities, ['code.review', 'repo.search']);
  assert.equal(card.endpoint.headers.Authorization, '[redacted]');
  assert.equal(card.endpoint.headers['X-Trace'], 'trace-1');
  assert.equal(card.endpoint.apiKey, '[redacted]');
  assert.equal(card.toolPermissions.env.GITHUB_TOKEN, '[redacted]');
  assert.equal(card.toolPermissions.env.MODE, 'readonly');
  assert.equal(card.trustRank, 3);
});

test('agent card normalization rejects invalid ids and unsupported protocols', () => {
  assert.throws(
    () => normalizeAgentCard({ id: '../bad', name: 'Bad', protocol: 'http', endpoint: { url: 'https://x.test' } }),
    /Invalid agent id/,
  );
  assert.throws(
    () => normalizeAgentCard({ id: 'agent.ok', name: 'Bad', protocol: 'ftp', endpoint: { url: 'https://x.test' } }),
    /Unsupported agent protocol/,
  );
});

test('agent router selects the lowest viable cost route within capability, trust, cost, and latency policy', () => {
  const agents = normalizeAgentCards([
    {
      id: 'agent.fast',
      name: 'Fast Internal',
      protocol: 'http',
      endpoint: { url: 'https://fast.example.test/dispatch' },
      capabilities: ['code.review', 'repo.search'],
      costModel: { perRequestCost: 0.2, perTokenCost: 0.00001 },
      latencyStats: { p95Ms: 2000 },
      trustLevel: 'internal',
    },
    {
      id: 'agent.cheap',
      name: 'Cheap Verified',
      protocol: 'a2a',
      endpoint: { url: 'https://cheap.example.test/a2a' },
      capabilities: ['code.review', 'repo.search'],
      costModel: { perRequestCost: 0.02, perTokenCost: 0.000001 },
      latencyStats: { p95Ms: 4500 },
      trustLevel: 'verified',
    },
    {
      id: 'agent.lowtrust',
      name: 'Low Trust',
      protocol: 'http',
      endpoint: { url: 'https://low.example.test/dispatch' },
      capabilities: ['code.review', 'repo.search'],
      costModel: { perRequestCost: 0.001 },
      latencyStats: { p95Ms: 500 },
      trustLevel: 'public',
    },
  ]);

  const decision = chooseAgentRoute({
    task: {
      id: 'task-interop',
      requiredCapabilities: ['code.review', 'repo.search'],
      estimatedTokens: 1000,
    },
    agents,
    constraints: {
      minTrustLevel: 'verified',
      maxCost: 0.05,
      maxLatencyMs: 5000,
    },
  });

  assert.equal(decision.status, 'selected');
  assert.equal(decision.agent.id, 'agent.cheap');
  assert.equal(decision.reason, 'selected_best_fit');
  assert.equal(decision.estimatedCost, 0.021);
  assert.equal(decision.estimatedLatencyMs, 4500);
});

test('agent router returns structured rejection reasons when no route is viable', () => {
  const agents = normalizeAgentCards([
    {
      id: 'agent.unavailable',
      name: 'Unavailable',
      protocol: 'http',
      endpoint: { url: 'https://unavailable.example.test/dispatch' },
      capabilities: ['code.review'],
      costModel: { perRequestCost: 0.01 },
      latencyStats: { p95Ms: 1000 },
      trustLevel: 'internal',
      available: false,
    },
    {
      id: 'agent.no-capability',
      name: 'No Capability',
      protocol: 'local',
      command: { executable: 'node', args: ['agent.js'] },
      capabilities: ['repo.search'],
      costModel: { perRequestCost: 0.01 },
      latencyStats: { p95Ms: 1000 },
      trustLevel: 'internal',
    },
  ]);

  const decision = chooseAgentRoute({
    task: {
      id: 'task-interop',
      requiredCapabilities: ['code.review', 'patch.apply'],
    },
    agents,
    constraints: {
      minTrustLevel: 'verified',
    },
  });

  assert.equal(decision.status, 'no_route');
  assert.equal(decision.agent, null);
  assert.equal(decision.reason, 'no_agent_satisfies_constraints');
  assert.deepEqual(decision.rejections.map((item) => item.reason), [
    'unavailable',
    'missing_capability',
  ]);
});

test('agent router honors optional policy callback after static constraints', () => {
  const agents = normalizeAgentCards([
    {
      id: 'agent.policy',
      name: 'Policy Agent',
      protocol: 'http',
      endpoint: { url: 'https://policy.example.test/dispatch' },
      capabilities: ['research.plan'],
      costModel: { perRequestCost: 0.01 },
      latencyStats: { p95Ms: 1000 },
      trustLevel: 'internal',
    },
  ]);

  const decision = chooseAgentRoute({
    task: { id: 'task-policy', requiredCapabilities: ['research.plan'] },
    agents,
    policy: () => ({ allowed: false, reason: 'workspace_locked' }),
  });

  assert.equal(decision.status, 'no_route');
  assert.equal(decision.rejections[0].reason, 'workspace_locked');
});

test('gateway request builder omits credentials and scopes task/context to granted capabilities', () => {
  const agent = normalizeAgentCard({
    id: 'agent.dispatch',
    name: 'Dispatch Agent',
    protocol: 'acp',
    endpoint: {
      url: 'https://dispatch.example.test/acp',
      headers: { Authorization: 'Bearer secret' },
    },
    capabilities: ['code.review', 'repo.search'],
    costModel: { perRequestCost: 0.02 },
    latencyStats: { p95Ms: 2500 },
    trustLevel: 'verified',
    toolPermissions: {
      allowed: ['repo.read'],
      env: { API_KEY: 'sk-secret' },
    },
  });

  const envelope = buildGatewayRequest({
    agent,
    task: {
      id: 'task-dispatch',
      requiredCapabilities: ['code.review'],
      prompt: 'Review this patch.',
      context: {
        'code.review': { diff: 'diff --git a/file.js b/file.js' },
        'repo.search': { query: 'ignored' },
        secrets: { token: 'do-not-send' },
      },
      credentials: { apiKey: 'never-send' },
    },
    grantedCapabilities: ['code.review'],
  });

  assert.equal(envelope.agent.id, 'agent.dispatch');
  assert.equal(envelope.agent.endpoint.headers, undefined);
  assert.equal(envelope.agent.toolPermissions.env, undefined);
  assert.deepEqual(envelope.capabilities, ['code.review']);
  assert.deepEqual(envelope.task.context, {
    'code.review': { diff: 'diff --git a/file.js b/file.js' },
  });
  assert.equal('credentials' in envelope.task, false);
  assert.equal('secrets' in envelope.task.context, false);
});

test('gateway request builder omits credential-shaped prompt and context fields', () => {
  const agent = normalizeAgentCard({
    id: 'agent.secure',
    name: 'Secure Agent',
    protocol: 'http',
    endpoint: { url: 'https://secure.example.test/dispatch' },
    capabilities: ['code.review'],
  });

  const envelope = buildGatewayRequest({
    agent,
    task: {
      id: 'task-secure',
      requiredCapabilities: ['code.review'],
      prompt: 'Review patch. API_KEY=sk-live-secret should not travel.',
      context: {
        'code.review': {
          diff: 'diff --git a/file.js b/file.js',
          credentials: { apiKey: 'sk-live-secret' },
          token: 'ghp_secret',
          nested: { password: 'do-not-send', note: 'keep' },
        },
      },
    },
  });

  assert.equal(envelope.task.prompt.includes('sk-live-secret'), false);
  assert.deepEqual(envelope.task.context, {
    'code.review': {
      diff: 'diff --git a/file.js b/file.js',
      nested: { note: 'keep' },
    },
  });
});

test('gateway request builder refuses to hide missing required capabilities', () => {
  const agent = normalizeAgentCard({
    id: 'agent.partial',
    name: 'Partial Agent',
    protocol: 'http',
    endpoint: { url: 'https://partial.example.test/dispatch' },
    capabilities: ['code.review'],
  });

  assert.throws(
    () => buildGatewayRequest({
      agent,
      task: {
        id: 'task-partial',
        requiredCapabilities: ['code.review', 'patch.apply'],
        prompt: 'Review and apply.',
      },
    }),
    /missing required capabilities/i,
  );
});

test('agent router treats invalid token estimates as over-budget instead of bypassing cost limits', () => {
  const decision = chooseAgentRoute({
    task: {
      id: 'task-bad-cost',
      requiredCapabilities: ['code.review'],
      estimatedTokens: 'not-a-number',
    },
    agents: [{
      id: 'agent.cost',
      name: 'Cost Agent',
      protocol: 'http',
      endpoint: { url: 'https://cost.example.test/dispatch' },
      capabilities: ['code.review'],
      costModel: { perTokenCost: 1 },
      trustLevel: 'verified',
    }],
    constraints: { maxCost: 0 },
  });

  assert.equal(decision.status, 'no_route');
  assert.equal(decision.rejections[0].reason, 'cost_above_limit');
});

test('delegated capability tokens bind task, agent, capability, mode, and expiry', () => {
  const token = createDelegatedCapabilityToken({
    taskId: 'task-delegate',
    agentId: 'agent.writer',
    capabilities: ['repo.read', 'patch.apply'],
    mode: 'mutation',
    issuedBy: 'owner',
    now: 10_000,
    ttlMs: 1_000,
  });

  assert.equal(token.taskId, 'task-delegate');
  assert.equal(token.agentId, 'agent.writer');
  assert.equal(token.secret, undefined);
  assert.equal(JSON.stringify(token).includes('live-secret'), false);
  assert.equal(
    verifyDelegatedCapabilityToken(token, {
      taskId: 'task-delegate',
      agentId: 'agent.writer',
      capability: 'patch.apply',
      mode: 'mutation',
      now: 10_500,
    }).valid,
    true,
  );
  assert.deepEqual(
    verifyDelegatedCapabilityToken(token, {
      taskId: 'task-delegate',
      agentId: 'agent.writer',
      capability: 'shell.exec',
      mode: 'mutation',
      now: 10_500,
    }).reasons,
    ['capability_not_delegated'],
  );
  assert.deepEqual(
    verifyDelegatedCapabilityToken(token, {
      taskId: 'task-delegate',
      agentId: 'agent.writer',
      capability: 'patch.apply',
      mode: 'mutation',
      now: 11_001,
    }).reasons,
    ['expired'],
  );
  assert.deepEqual(
    verifyDelegatedCapabilityToken({
      ...token,
      tokenId: 'dct_forged',
      signature: 'forged',
      expiresAt: 99_999,
    }, {
      taskId: 'task-delegate',
      agentId: 'agent.writer',
      capability: 'patch.apply',
      mode: 'mutation',
      now: 10_500,
    }).reasons,
    ['invalid_signature'],
  );
});

test('external agent gateway exposes redacted agent cards and read-only scoped envelopes by default', async () => {
  const dispatched = [];
  const gateway = new ExternalAgentGateway({
    agents: [{
      id: 'agent.reader',
      name: 'Reader',
      protocol: 'a2a',
      endpoint: {
        url: 'https://reader.example.test/a2a',
        headers: { Authorization: 'Bearer secret-token' },
      },
      capabilities: ['repo.read', 'code.review'],
      trustLevel: 'verified',
    }],
    dispatch: async (envelope) => {
      dispatched.push(envelope);
      return { ok: true, envelope };
    },
  });

  const cards = gateway.listAgentCards();
  const result = await gateway.dispatchTask({
    agentId: 'agent.reader',
    task: {
      id: 'task-read',
      requiredCapabilities: ['repo.read'],
      prompt: 'Summarize this repository. token=ghp_should_not_leave',
      context: {
        'repo.read': { files: ['README.md'], apiKey: 'sk-should-not-leave' },
        'patch.apply': { diff: 'ignored' },
      },
    },
  });

  assert.equal(cards[0].endpoint.headers.Authorization, '[redacted]');
  assert.equal(result.status, 'dispatched');
  assert.equal(dispatched[0].mode, 'read');
  assert.deepEqual(dispatched[0].capabilities, ['repo.read']);
  assert.equal(JSON.stringify(dispatched[0]).includes('ghp_should_not_leave'), false);
  assert.equal(JSON.stringify(dispatched[0]).includes('sk-should-not-leave'), false);
});

test('external agent gateway blocks mutation unless approval and delegated token are present', async () => {
  const token = createDelegatedCapabilityToken({
    taskId: 'task-write',
    agentId: 'agent.writer',
    capabilities: ['patch.apply'],
    mode: 'mutation',
    issuedBy: 'owner',
    now: 5_000,
    ttlMs: 5_000,
  });
  const gateway = new ExternalAgentGateway({
    now: () => 5_500,
    agents: [{
      id: 'agent.writer',
      name: 'Writer',
      protocol: 'acp',
      endpoint: { url: 'https://writer.example.test/acp' },
      capabilities: ['repo.read', 'patch.apply'],
      trustLevel: 'internal',
    }],
    dispatch: async () => ({ ok: true }),
  });

  const noApproval = await gateway.dispatchTask({
    agentId: 'agent.writer',
    task: {
      id: 'task-write',
      requiredCapabilities: ['patch.apply'],
      prompt: 'Apply this patch.',
      mutation: true,
    },
  });
  const noToken = await gateway.dispatchTask({
    agentId: 'agent.writer',
    approval: { approved: true, approvedBy: 'owner' },
    task: {
      id: 'task-write',
      requiredCapabilities: ['patch.apply'],
      prompt: 'Apply this patch.',
      mutation: true,
    },
  });
  const dispatched = await gateway.dispatchTask({
    agentId: 'agent.writer',
    approval: { approved: true, approvedBy: 'owner' },
    capabilityToken: token,
    task: {
      id: 'task-write',
      requiredCapabilities: ['patch.apply'],
      prompt: 'Apply this patch.',
      mutation: true,
    },
  });

  assert.equal(noApproval.status, 'blocked');
  assert.equal(noApproval.reason, 'mutation_requires_approval');
  assert.equal(noToken.status, 'blocked');
  assert.equal(noToken.reason, 'delegated_capability_token_invalid');
  assert.equal(dispatched.status, 'dispatched');
});

test('external agent gateway requires mutation token coverage for every requested capability', async () => {
  const readOnlyToken = createDelegatedCapabilityToken({
    taskId: 'task-mixed',
    agentId: 'agent.mixed',
    capabilities: ['repo.read'],
    mode: 'mutation',
    issuedBy: 'owner',
    now: 1_000,
    ttlMs: 5_000,
  });
  const gateway = new ExternalAgentGateway({
    now: () => 1_500,
    agents: [{
      id: 'agent.mixed',
      name: 'Mixed Agent',
      protocol: 'http',
      endpoint: { url: 'https://mixed.example.test/dispatch' },
      capabilities: ['repo.read', 'patch.apply'],
      trustLevel: 'internal',
    }],
  });

  const result = await gateway.dispatchTask({
    agentId: 'agent.mixed',
    approval: { approved: true, approvedBy: 'owner' },
    capabilityToken: readOnlyToken,
    task: {
      id: 'task-mixed',
      requiredCapabilities: ['repo.read', 'patch.apply'],
      prompt: 'Read context and apply a patch.',
      mutation: true,
    },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'delegated_capability_token_invalid');
  assert.deepEqual(result.tokenReasons, ['patch.apply:capability_not_delegated']);
});
