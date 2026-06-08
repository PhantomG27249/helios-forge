import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateMcpTrustPolicyCandidate,
  proposeMcpTrustPolicies,
} from '../src/harness-sidecar/meta/mcpTrustEvolution.js';
import { buildRuntimeMountManifest, saveCapabilityRecord } from '../src/harness-sidecar/capabilities/capabilityStore.js';
import { createMcpPolicy } from '../src/harness-sidecar/tools/mcpPolicy.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('mcp trust evolution treats suspicious output and startup failures as hard cases', () => {
  const candidates = proposeMcpTrustPolicies({
    coreset: [
      { caseId: 'poisoned_result', reason: 'suspicious_mcp_output', serverId: 'docs' },
      { caseId: 'startup_failed', reason: 'capability_startup_failed', serverId: 'search' },
    ],
  });

  assert.equal(candidates[0].status, 'shadow_only');
  assert.deepEqual(candidates[0].sourceCaseIds, ['poisoned_result', 'startup_failed']);
  assert.equal(candidates[0].quarantineServers.includes('docs'), true);
  assert.equal(candidates[0].trustAdjustments.search, 'lower');
});

test('mcp trust evaluator quarantines untrusted tools and blocks write scope expansion without approval', () => {
  const quarantine = evaluateMcpTrustPolicyCandidate({
    candidate: {
      quarantineServers: ['docs'],
      writeScopeExpansions: [],
      status: 'shadow_only',
    },
    mcpCase: { serverId: 'docs', reason: 'suspicious_mcp_output' },
  });
  const expansion = evaluateMcpTrustPolicyCandidate({
    candidate: {
      quarantineServers: [],
      writeScopeExpansions: [{ serverId: 'github', scope: 'repo:write' }],
      status: 'shadow_only',
    },
    mcpCase: { serverId: 'github' },
  });

  assert.equal(quarantine.reasons.includes('server_quarantined'), true);
  assert.equal(quarantine.safety.status, 'shadow_only');
  assert.equal(expansion.safety.status, 'human_required');
  assert.equal(expansion.promotable, false);
  assert.equal(expansion.reasons.includes('write_scope_expansion_requires_approval'), true);
});

test('mcp policy and capability manifest can carry trust metadata without changing default decisions', async () => {
  const policy = createMcpPolicy({
    allowedServers: ['docs'],
    allowedTools: ['docs.search'],
    trustPolicy: { policyId: 'mcp_shadow', status: 'shadow_only' },
  });
  const decision = policy.evaluateToolCall({ serverId: 'docs', tool: 'docs.search' });

  assert.equal(decision.status, 'allowed');
  assert.deepEqual(decision.policy, { policyId: 'mcp_shadow', status: 'shadow_only', mode: 'metadata_only' });

  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-mcp-trust-'));
  try {
    await saveCapabilityRecord({
      workspaceRoot,
      record: { id: 'docs', type: 'mcp', name: 'Docs', enabled: true },
    });
    const manifest = await buildRuntimeMountManifest({
      workspaceRoot,
      trustPolicy: { policyId: 'mcp_shadow', status: 'shadow_only' },
    });

    assert.equal(manifest.counts.mcp, 1);
    assert.deepEqual(manifest.trustPolicy, { policyId: 'mcp_shadow', status: 'shadow_only', mode: 'metadata_only' });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
