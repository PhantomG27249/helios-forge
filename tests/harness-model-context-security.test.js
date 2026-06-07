import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compactContextItems } from '../src/harness-sidecar/context/compaction.js';
import { DecisionLedger } from '../src/harness-sidecar/context/decisionLedger.js';
import { getContextProfile } from '../src/harness-sidecar/context/contextProfiles.js';
import { ModelGateway } from '../src/harness-sidecar/model/modelGateway.js';
import { getModelProfile } from '../src/harness-sidecar/model/modelProfiles.js';
import { repairJsonObject } from '../src/harness-sidecar/model/structuredOutputRepair.js';
import { parseToolCall } from '../src/harness-sidecar/model/toolCallParser.js';
import { createApprovalRequest } from '../src/harness-sidecar/security/approvalGates.js';
import { createPermissionPolicy } from '../src/harness-sidecar/security/permissionPolicy.js';
import { brokerMcpToolCall } from '../src/harness-sidecar/tools/mcpBroker.js';

test('model profiles expose qwen vision defaults and critic profile', () => {
  const deep = getModelProfile('qwen36_vlm_deep');
  const critic = getModelProfile('critic_low_temp');

  assert.equal(deep.supportsVision, true);
  assert.equal(deep.maxContextTokens, 262000);
  assert.equal(critic.defaultTemperature, 0.1);
});

test('structured output repair parses fenced or trailing-comma JSON objects', () => {
  const repaired = repairJsonObject('```json\n{ "tool": "shell", "args": { "command": "npm test", }, }\n```');

  assert.equal(repaired.tool, 'shell');
  assert.equal(repaired.args.command, 'npm test');
});

test('model gateway records profile, token accounting, and structured repair events', async () => {
  const events = [];
  const gateway = new ModelGateway({
    emitEvent: (event) => events.push(event),
    provider: async () => ({
      text: '```json\n{ "decision": "approve", "confidence": 0.8, }\n```',
      usage: { inputTokens: 12, outputTokens: 8 },
    }),
  });

  const result = await gateway.call({
    taskId: 'task_model',
    purpose: 'critic_vote',
    profileName: 'critic_low_temp',
    messages: [{ role: 'user', content: 'Return a JSON decision.' }],
    structuredOutput: true,
  });

  assert.match(result.callId, /^model_/);
  assert.equal(result.profile.name, 'critic_low_temp');
  assert.equal(result.usage.totalTokens, 20);
  assert.equal(result.structured.decision, 'approve');
  assert.equal(events.some((event) => event.type === 'model_call.started'), true);
  assert.equal(events.some((event) => event.type === 'model_call.completed' && event.totalTokens === 20), true);
});

test('tool call parser validates required fields', () => {
  const parsed = parseToolCall('{ "tool": "shell", "args": { "command": "npm test" } }');

  assert.equal(parsed.valid, true);
  assert.equal(parsed.tool, 'shell');
  assert.equal(parseToolCall('{ "args": {} }').valid, false);
});

test('context profiles and compaction preserve priority zero items', () => {
  const profile = getContextProfile('coding_small');
  const compacted = compactContextItems({
    items: [
      { id: 'instructions', priority: 0, tokensEstimated: 500 },
      { id: 'log', priority: 3, tokensEstimated: profile.maxTokens },
    ],
    maxTokens: 800,
  });

  assert.equal(profile.name, 'coding_small');
  assert.equal(compacted.items.some((item) => item.id === 'instructions'), true);
  assert.equal(compacted.excluded.includes('log'), true);
});

test('decision ledger records decisions and rejected approaches', () => {
  const ledger = new DecisionLedger();
  ledger.recordDecision({ decision: 'Use sidecar orchestration', evidence: ['plan'] });
  ledger.recordRejectedApproach({ approach: 'Put swarms in UI', reason: 'Too stateful' });

  const snapshot = ledger.snapshot();
  assert.equal(snapshot.decisions.length, 1);
  assert.equal(snapshot.rejectedApproaches[0].approach, 'Put swarms in UI');
});

test('permission policy allows safe tools and gates risky MCP tools', () => {
  const policy = createPermissionPolicy({
    mode: 'safe_edit',
    allowedTools: ['github.search_issues'],
    riskyTools: ['github.merge_pr'],
  });

  assert.equal(policy.evaluateToolCall({ tool: 'github.search_issues' }).allowed, true);
  assert.equal(policy.evaluateToolCall({ tool: 'github.merge_pr' }).requiresApproval, true);
  assert.equal(policy.evaluateToolCall({ tool: 'github.delete_repo' }).allowed, false);
});

test('MCP broker returns approval request for risky tool calls', () => {
  const policy = createPermissionPolicy({
    mode: 'safe_edit',
    allowedTools: ['github.search_issues'],
    riskyTools: ['github.merge_pr'],
  });
  const result = brokerMcpToolCall({
    tool: 'github.merge_pr',
    args: { pr: 12 },
    policy,
  });

  assert.equal(result.status, 'approval_required');
  assert.equal(result.approval.risk, 'high');
});

test('approval gate creates compact human approval request', () => {
  const approval = createApprovalRequest({
    taskId: 'task_security',
    risk: 'high',
    reason: 'External paid API call',
    proposedAction: { tool: 'web_search', query: 'papers' },
  });

  assert.match(approval.actionId, /^act_/);
  assert.equal(approval.choices.includes('approve'), true);
});
