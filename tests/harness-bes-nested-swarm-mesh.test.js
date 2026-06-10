import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runBesLaneRuntime } from '../src/harness-sidecar/bes/laneRuntime.js';
import { buildSwarmA2AEnvelope } from '../src/harness-sidecar/interop/a2aSwarmEnvelope.js';
import { ExternalAgentGateway } from '../src/harness-sidecar/interop/externalAgentGateway.js';
import { createLaneMemoryGraphContextPacket } from '../src/harness-sidecar/rag/hierarchicalMemoryRetriever.js';

test('A2A and Memory Graph RAG context flow through a BES lane without granting authority', async () => {
  const envelope = buildSwarmA2AEnvelope({
    task: { taskId: 'task-nested-mesh', task: 'close research gap' },
    attempt: { attemptId: 'attempt-1', strategy: 'research' },
    context: {
      candidateRef: 'candidate-1',
      rhoCaseIds: ['rho-case-1'],
      memoryGraphRefs: ['memory-fact-1'],
      lineage: { parents: ['agent-1', 'agent-2'] },
      trust: { external: false, verified: false },
      requiredVerification: ['citation_audit'],
    },
  });
  const memoryGraphContext = createLaneMemoryGraphContextPacket({
    local: { nodeIds: ['local-hard-case-1'] },
    swarmCell: { nodeIds: ['cell-lesson-1'] },
    global: { nodeIds: ['global-pattern-1'], provenance: ['trace-1'] },
    conflicts: [{ id: 'conflict-1', status: 'needs_review' }],
    retrieval: { trace: ['active_fact:1'] },
  });

  const result = await runBesLaneRuntime({
    lane: 'research',
    taskId: 'task-nested-mesh',
    a2aEnvelope: envelope,
    memoryGraphContext,
    candidates: [{ candidateId: 'candidate-1', status: 'shadow_only' }],
    hardCases: [{ caseId: 'rho-case-1', reasons: ['citation_gap'] }],
    evaluator: () => ({
      score: 0.75,
      reasons: ['citation_gap_addressed'],
      safetyStatus: 'shadow_only',
    }),
  });

  const candidate = result.candidates[0];
  assert.equal(candidate.promotion.allowed, false);
  assert.equal(candidate.a2a.message.context.candidateRef, 'candidate-1');
  assert.deepEqual(candidate.lineage.parents, ['agent-1', 'agent-2']);
  assert.deepEqual(candidate.memoryGraph.global.nodeIds, ['global-pattern-1']);
  assert.deepEqual(candidate.memoryGraph.conflicts[0].id, 'conflict-1');
  assert.ok(candidate.lineage.candidateId);
});

test('external A2A gateway marks carried lineage as untrusted by default', async () => {
  const gateway = new ExternalAgentGateway({
    agents: [{
      id: 'external-researcher',
      name: 'External Researcher',
      protocol: 'a2a',
      endpoint: { url: 'https://agents.example.test/a2a' },
      capabilities: ['a2a'],
      trustLevel: 'public',
    }],
  });

  const envelope = gateway.buildEnvelope({
    agentId: 'external-researcher',
    task: {
      id: 'task-external',
      prompt: 'inspect claim',
      requiredCapabilities: ['a2a'],
      context: {
        a2a: {
          candidateRef: 'candidate-external',
          besLane: 'research',
          trust: { external: false, verified: true },
        },
      },
    },
  });

  assert.equal(envelope.task.context.a2a.candidateRef, 'candidate-external');
  assert.equal(envelope.task.context.a2a.trust.external, true);
  assert.equal(envelope.task.context.a2a.trust.verified, false);
});

test('memory graph lane packet preserves scalar and object provenance', () => {
  const scalar = createLaneMemoryGraphContextPacket({
    global: { nodeIds: ['global-1'], provenance: 'trace-1' },
  });
  const object = createLaneMemoryGraphContextPacket({
    global: { nodeIds: ['global-2'], provenance: { id: 'trace-2' } },
  });

  assert.deepEqual(scalar.provenance, ['trace-1']);
  assert.deepEqual(object.provenance, ['trace-2']);
});
