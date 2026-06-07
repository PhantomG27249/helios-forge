import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recordDeadEndAttempt } from '../src/harness-sidecar/memory/deadEnds.js';
import { evaluateMemoryRecord, scoreMemoryCorpus } from '../src/harness-sidecar/memory/memoryEvals.js';
import { MemoryGraph } from '../src/harness-sidecar/memory/memoryGraph.js';
import { detectMemoryConflicts } from '../src/harness-sidecar/memory/memoryConflictResolver.js';
import { decideReflectionGate } from '../src/harness-sidecar/memory/reflectionGate.js';
import { recordReusableFix } from '../src/harness-sidecar/memory/reusableFixes.js';
import { recordSolvedSubgoal } from '../src/harness-sidecar/memory/solvedSubgoals.js';

test('reflection gate promotes evidence-backed reviewed candidates', () => {
  const decision = decideReflectionGate({
    type: 'reusable_fix',
    summary: 'Retry verifier once after transient websocket disconnect.',
    evidence: ['traces/task_42/events.jsonl'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });

  assert.equal(decision.status, 'promotable');
  assert.equal(decision.reasons.includes('evidence_present'), true);
  assert.equal(decision.reasons.includes('validator_backed'), true);
});

test('reflection gate sends weak or human-pending candidates to review', () => {
  const decision = decideReflectionGate({
    type: 'solved_subgoal',
    summary: 'Unverified claim from one run.',
    evidence: ['traces/task_43/events.jsonl'],
    reviewStatus: 'candidate',
    validatorBacked: false,
  });

  assert.equal(decision.status, 'needs_review');
  assert.equal(decision.reasons.includes('review_pending'), true);
  assert.equal(decision.reasons.includes('validator_missing'), true);
});

test('dead-end recorder emits candidate memory only after repeated strategy failures', () => {
  const graph = new MemoryGraph();
  const first = recordDeadEndAttempt({
    graph,
    taskId: 'task_dead',
    strategySignature: 'npm-test-without-build',
    failure: 'same assertion failed',
    evidence: ['traces/task_dead/attempt-1.jsonl'],
    threshold: 2,
  });
  const second = recordDeadEndAttempt({
    graph,
    taskId: 'task_dead',
    strategySignature: 'npm-test-without-build',
    failure: 'same assertion failed',
    evidence: ['traces/task_dead/attempt-2.jsonl'],
    threshold: 2,
  });

  assert.equal(first.memory, null);
  assert.equal(second.memory.type, 'dead_end');
  assert.equal(second.memory.reviewStatus, 'candidate');
  assert.equal(second.memory.evidence.length, 2);
  assert.equal(graph.findByType('dead_end').length, 1);
});

test('memory graph records solved subgoals and reusable fixes with provenance', () => {
  const graph = new MemoryGraph();
  const subgoal = recordSolvedSubgoal({
    graph,
    taskId: 'task_goal',
    subgoalId: 'S3',
    description: 'Verifier passes after focused test run.',
    evidence: ['tests/harness-memory-graph.test.js'],
  });
  const fix = recordReusableFix({
    graph,
    taskId: 'task_goal',
    pattern: 'Run node --test against the focused harness test first.',
    appliesTo: ['node:test', 'harness'],
    evidence: ['tests/harness-memory-graph.test.js'],
  });

  assert.equal(graph.getMemory(subgoal.memoryId).provenance[0].taskId, 'task_goal');
  assert.equal(graph.getMemory(fix.memoryId).type, 'reusable_fix');
  assert.equal(graph.findRelations({ from: subgoal.memoryId, type: 'supports' })[0].to, fix.memoryId);
});

test('contradictory memories are quarantined and conflict records are emitted', () => {
  const graph = new MemoryGraph();
  const left = graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'npm test',
    summary: 'The verifier command is npm test.',
    evidence: ['docs/a.md'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });
  const right = graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'npm run verify',
    summary: 'The verifier command is npm run verify.',
    evidence: ['docs/b.md'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });

  const conflicts = detectMemoryConflicts({ graph });

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, 'memory_conflict');
  assert.deepEqual(conflicts[0].conflictingMemoryIds.sort(), [left.memoryId, right.memoryId].sort());
  assert.equal(graph.getMemory(left.memoryId).reviewStatus, 'quarantined');
  assert.equal(graph.getMemory(right.memoryId).reviewStatus, 'quarantined');
});

test('stale memories are quarantined when superseded by newer evidence', () => {
  const graph = new MemoryGraph();
  const oldMemory = graph.addMemory({
    type: 'reusable_fix',
    summary: 'Use legacy verifier command.',
    evidence: ['docs/old.md'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });
  const newMemory = graph.addMemory({
    type: 'reusable_fix',
    summary: 'Use focused node --test command.',
    evidence: ['docs/new.md'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
    supersedes: [oldMemory.memoryId],
  });

  const oldDecision = decideReflectionGate(graph.getMemory(oldMemory.memoryId));
  const newDecision = decideReflectionGate(graph.getMemory(newMemory.memoryId));

  assert.equal(oldDecision.status, 'quarantined');
  assert.equal(oldDecision.reasons.includes('superseded'), true);
  assert.equal(newDecision.status, 'promotable');
});

test('memory evals score deterministic quality signals for records and corpora', () => {
  const strong = evaluateMemoryRecord({
    type: 'reusable_fix',
    summary: 'Run focused test before full suite.',
    evidence: ['tests/harness-memory-graph.test.js'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });
  const weak = evaluateMemoryRecord({
    type: 'dead_end',
    summary: '',
    evidence: [],
    reviewStatus: 'candidate',
    validatorBacked: false,
  });
  const corpus = scoreMemoryCorpus({ records: [strong.record, weak.record] });

  assert.equal(strong.score, 100);
  assert.equal(weak.score < strong.score, true);
  assert.equal(corpus.totalRecords, 2);
  assert.equal(corpus.averageScore, Math.round((strong.score + weak.score) / 2));
  assert.equal(corpus.promotableCount, 1);
});
