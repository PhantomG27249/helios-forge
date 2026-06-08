import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FAILURE_CATEGORIES,
  classifyHarnessFailure,
} from '../src/harness-sidecar/reliability/errorTaxonomy.js';
import {
  buildUnknownToolRecovery,
  recoverMalformedToolCalls,
} from '../src/harness-sidecar/reliability/toolCallRecovery.js';
import { NoProgressDetector } from '../src/harness-sidecar/reliability/noProgressDetector.js';
import { DegradedModeRegistry } from '../src/harness-sidecar/reliability/degradedModeRegistry.js';
import { ToolRegistry } from '../src/harness-sidecar/tools/toolRegistry.js';

test('failure taxonomy covers Wave 3 recovery categories with structured actions', () => {
  assert.deepEqual(FAILURE_CATEGORIES, [
    'malformed_tool_call',
    'unknown_tool',
    'tool_timeout',
    'repeated_tool_failure',
    'patch_apply_failed',
    'sandbox_crash',
    'no_progress',
    'budget_exhausted',
  ]);

  for (const category of FAILURE_CATEGORIES) {
    const classification = classifyHarnessFailure({ category });

    assert.equal(classification.category, category);
    assert.equal(typeof classification.severity, 'string');
    assert.equal(typeof classification.recoverable, 'boolean');
    assert.equal(typeof classification.recommendedAction, 'string');
    assert.ok(classification.recommendedAction.length > 0);
  }
});

test('failure taxonomy infers categories from common harness failures', () => {
  assert.equal(classifyHarnessFailure({
    error: new Error('tool timed out after 30000ms'),
  }).category, 'tool_timeout');
  assert.equal(classifyHarnessFailure({
    reason: 'unknown_tool',
  }).category, 'unknown_tool');
  assert.equal(classifyHarnessFailure({
    reason: 'patch_apply_failed',
  }).category, 'patch_apply_failed');
  assert.equal(classifyHarnessFailure({
    error: new Error('sandbox process crashed with exit code 1'),
  }).category, 'sandbox_crash');
  assert.equal(classifyHarnessFailure({
    budget: { exhausted: true },
  }).category, 'budget_exhausted');
});

test('malformed tool-call recovery repairs simple truncated JSON and classifies the failure', () => {
  const recovered = recoverMalformedToolCalls({
    text: '{ "tool": "demo.echo", "args": { "value": "fixed" }',
  });

  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.classification.category, 'malformed_tool_call');
  assert.deepEqual(recovered.calls, [
    { id: null, name: 'demo.echo', args: { value: 'fixed' } },
  ]);
});

test('unknown tool recovery returns available tools and a retry instruction', () => {
  const registry = new ToolRegistry();
  registry.register({ name: 'safe.echo', description: 'Echo input', execute: async () => ({}) });
  registry.register({ name: 'patch.apply', description: 'Apply patch', execute: async () => ({}) });

  const recovery = buildUnknownToolRecovery({
    toolName: 'missing.tool',
    toolRegistry: registry,
  });

  assert.equal(recovery.category, 'unknown_tool');
  assert.equal(recovery.recoverable, true);
  assert.deepEqual(recovery.availableTools, ['safe.echo', 'patch.apply']);
  assert.match(recovery.instruction, /available tool/);
});

test('no-progress detector reports repeated identical tool failures', () => {
  const detector = new NoProgressDetector({ threshold: 3 });
  const first = detector.recordToolResult({
    name: 'safe.echo',
    status: 'blocked',
    reason: 'tool_error',
    error: 'same failure',
  });
  const second = detector.recordToolResult({
    name: 'safe.echo',
    status: 'blocked',
    reason: 'tool_error',
    error: 'same failure',
  });
  const third = detector.recordToolResult({
    name: 'safe.echo',
    status: 'blocked',
    reason: 'tool_error',
    error: 'same failure',
  });

  assert.equal(first.noProgress, false);
  assert.equal(second.noProgress, false);
  assert.equal(third.noProgress, true);
  assert.equal(third.category, 'no_progress');
  assert.equal(third.repeatedFailure.category, 'repeated_tool_failure');
  assert.equal(third.count, 3);
});

test('degraded mode registry records modes and creates final partial report events', () => {
  const events = [];
  const registry = new DegradedModeRegistry({
    taskId: 'task_degraded',
    emitEvent: (event) => events.push(event),
  });

  const mode = registry.enter({
    mode: 'visual_adapter_unavailable',
    category: 'sandbox_crash',
    reason: 'browser runtime crashed',
    detail: { adapter: 'browser' },
  });
  const report = registry.finalReport({
    summary: 'Continued without browser screenshots.',
  });

  assert.equal(mode.active, true);
  assert.equal(mode.category, 'sandbox_crash');
  assert.equal(report.type, 'recovery.partial_report_ready');
  assert.equal(report.taskId, 'task_degraded');
  assert.equal(report.degradedModes.length, 1);
  assert.equal(events[0].type, 'recovery.degraded_mode_entered');
  assert.equal(events[1].type, 'recovery.partial_report_ready');
});
