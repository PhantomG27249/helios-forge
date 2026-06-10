import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runBudgetPolicyBesLane } from '../src/harness-sidecar/meta/budgetPolicyEvolution.js';
import { runCompactionPolicyBesLane } from '../src/harness-sidecar/meta/compactionPolicyEvolution.js';
import { runContextPolicyBesLane } from '../src/harness-sidecar/meta/contextPolicyEvolution.js';
import { runMcpTrustPolicyBesLane } from '../src/harness-sidecar/meta/mcpTrustEvolution.js';
import { runMemoryPolicyBesLane } from '../src/harness-sidecar/meta/memoryPolicyEvolution.js';
import { runToolLoopPolicyBesLane } from '../src/harness-sidecar/meta/toolLoopPolicyEvolution.js';
import { runVisualPolicyBesLane } from '../src/harness-sidecar/meta/visualPolicyEvolution.js';

test('wraps context policy candidates in non-promotable BES lane evidence', async () => {
  const result = await runContextPolicyBesLane({
    taskId: 'task-context',
    coreset: { items: [{ caseId: 'case-context', reason: 'missing_context', relevantItems: 3, requiredItems: 3 }] },
  });

  assert.equal(result.lane, 'context');
  assert.equal(result.candidates[0].policyId, 'context_shadow_1');
  assert.equal(result.candidates[0].promotion.allowed, false);
  assert.ok(result.candidates[0].evidence.sources.includes('domain_eval'));
});

test('wraps compaction, tool, budget, visual, and memory policy lanes', async () => {
  const cases = {
    compaction: await runCompactionPolicyBesLane({
      coreset: { items: [{ caseId: 'case-compaction', reason: 'compaction_lost_constraints', lostConstraints: ['must keep API key redacted'] }] },
    }),
    tool: await runToolLoopPolicyBesLane({
      coreset: { items: [{ caseId: 'case-tool', reason: 'unknown_tool', recoveredByFallback: true }] },
    }),
    budget: await runBudgetPolicyBesLane({
      coreset: { items: [{ caseId: 'case-budget', reason: 'low_confidence_verification', confidence: 0.3 }] },
    }),
    visual: await runVisualPolicyBesLane({
      coreset: { items: [{ caseId: 'case-visual', reason: 'visual_false_negative', artifactSupported: true }] },
    }),
    memory: await runMemoryPolicyBesLane({
      coreset: { items: [{ caseId: 'case-memory', reasons: ['memgraph_pending_activation_stall'], provenance: ['trace-1'] }] },
    }),
  };

  for (const [lane, result] of Object.entries(cases)) {
    assert.equal(result.lane, lane);
    assert.ok(result.candidates.length >= 1);
    assert.equal(result.candidates[0].status, 'shadow_only');
    assert.equal(result.candidates[0].promotion.allowed, false);
    assert.ok(result.candidates[0].evidence.sources.includes('domain_eval'));
  }
});

test('blocks MCP trust lane candidates that widen write scope without approval', async () => {
  const result = await runMcpTrustPolicyBesLane({
    coreset: { items: [{ caseId: 'case-mcp', reason: 'unexpected_write_scope', serverId: 'unsafe-server' }] },
    candidateOverrides: [{ writeScopeExpansions: ['C:\\Users\\jackj'] }],
  });

  const candidate = result.candidates[0];
  assert.equal(result.lane, 'mcp_trust');
  assert.equal(candidate.promotion.allowed, false);
  assert.ok(candidate.evidence.domain.reasons.includes('write_scope_expansion_requires_approval'));
  assert.equal(candidate.evidence.domain.safety.status, 'human_required');
});

test('policy lane wrappers evaluate every hard case in the supplied coreset', async () => {
  const memory = await runMemoryPolicyBesLane({
    coreset: {
      items: [
        { caseId: 'case-memory-1', reasons: ['memgraph_pending_activation_stall'], provenance: ['trace-1'] },
        { caseId: 'case-memory-2', reasons: ['memgraph_fragmentation'], provenance: ['trace-2'] },
      ],
    },
  });
  const memoryReasons = memory.candidates.flatMap((candidate) => candidate.evidence.domain.reasons);
  const mcp = await runMcpTrustPolicyBesLane({
    coreset: {
      items: [
        { caseId: 'case-mcp-1', reason: 'suspicious_mcp_output', serverId: 'server-a' },
        { caseId: 'case-mcp-2', reason: 'capability_startup_failed', serverId: 'server-b' },
      ],
    },
  });

  assert.equal(memory.candidates[0].evidence.domain.caseCount, 2);
  assert.ok(memoryReasons.includes('schema_threshold_addresses_activation_stall'));
  assert.ok(memoryReasons.includes('bridging_threshold_addresses_fragmentation'));
  assert.equal(mcp.candidates[0].evidence.domain.caseCount, 2);
  assert.ok(mcp.candidates[0].evidence.domain.reasons.includes('server_quarantined'));
  assert.ok(mcp.candidates[0].evidence.domain.reasons.includes('trust_tier_lowered_after_startup_failure'));
});
