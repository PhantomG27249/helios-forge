import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mineSkillNeedsFromRho } from '../src/harness-sidecar/skills/skillNeedMiner.js';

const traces = [
  {
    traceId: 'trace-visual-1',
    failures: [{ category: 'visual_false_negative', reason: 'browser screenshot missed overlap' }],
    verifierEvidence: { missing: true },
    tools: ['browser.preview', 'visual.verifier.run'],
  },
  {
    traceId: 'trace-visual-2',
    failureModes: ['visual_false_negative', 'missing_artifact_context'],
    tools: ['browser.preview'],
  },
  {
    traceId: 'trace-cite-1',
    failureModes: ['citation_missing', 'research_synthesis_drift'],
  },
  {
    traceId: 'trace-tool-1',
    failures: [{ category: 'malformed_mcp_call', reason: 'bad arguments' }],
  },
  {
    traceId: 'trace-approval-1',
    failureModes: ['approval_confusion', 'unsafe_resume'],
  },
  {
    traceId: 'trace-memory-1',
    failureModes: ['memory_retrieval_miss', 'rag_context_gap'],
  },
  {
    traceId: 'trace-verifier-1',
    failureModes: ['missing_verifier_evidence'],
  },
];

const coreset = {
  items: [
    { id: 'rho-visual-a', traceId: 'trace-visual-1', failureModes: ['visual_false_negative'] },
    { id: 'rho-visual-b', traceId: 'trace-visual-2', reasons: ['missing_artifact_context'] },
    { id: 'rho-cite', traceId: 'trace-cite-1', reasons: ['citation_missing'] },
    { id: 'rho-tool', traceId: 'trace-tool-1', failureModes: ['malformed_mcp_call'] },
    { id: 'rho-approval', traceId: 'trace-approval-1', failureModes: ['approval_confusion'] },
    { id: 'rho-memory', traceId: 'trace-memory-1', failureModes: ['memory_retrieval_miss'] },
    { id: 'rho-verifier', traceId: 'trace-verifier-1', failureModes: ['missing_verifier_evidence'] },
  ],
};

test('skill need miner ranks repeated RHO failures into reusable skill needs', () => {
  const needs = mineSkillNeedsFromRho({ coreset, traces, existingCapabilities: [] });

  assert.equal(needs[0].needId, 'skill_need_visual_debugging_repair');
  assert.equal(needs[0].title, 'Visual Debugging Repair');
  assert.deepEqual(needs[0].targetCapabilities, ['browser.preview', 'visual.verifier.run']);
  assert.equal(needs[0].priority > 0.8, true);
  assert.equal(needs[0].evidence.length, 2);
  assert.equal(needs.some((need) => need.needId === 'skill_need_research_citation_repair'), true);
  assert.equal(needs.some((need) => need.needId === 'skill_need_tool_mcp_call_repair'), true);
  assert.equal(needs.some((need) => need.needId === 'skill_need_approval_resume_repair'), true);
  assert.equal(needs.some((need) => need.needId === 'skill_need_memory_rag_retrieval_repair'), true);
  assert.equal(needs.some((need) => need.needId === 'skill_need_verifier_evidence_repair'), true);
});

test('skill need miner avoids duplicate generated skills and requests adaptation instead', () => {
  const [visualNeed] = mineSkillNeedsFromRho({
    coreset,
    traces,
    existingCapabilities: [
      {
        id: 'systematic-debugging',
        type: 'skill',
        name: 'Systematic Debugging',
        path: 'C:\\Users\\jackj\\.codex\\superpowers\\skills\\systematic-debugging\\SKILL.md',
        metadata: { trigger: 'Use when debugging failures, verifier misses, and visual regressions.' },
      },
    ],
  });

  assert.equal(visualNeed.duplicateOf, 'systematic-debugging');
  assert.equal(visualNeed.sourceSkill.name, 'Systematic Debugging');
  assert.equal(visualNeed.sourceSkill.permission, 'snapshot_for_local_evaluation_only');
  assert.match(visualNeed.requestedAdaptation, /Helios visual verifier traces/i);
});

test('skill need miner exposes skill-creator scaffold when installed', () => {
  const needs = mineSkillNeedsFromRho({
    coreset,
    traces,
    existingCapabilities: [
      {
        id: 'skill-creator',
        type: 'skill',
        name: 'Skill Creator',
        package: 'anthropics/skill-creator',
        url: 'https://smithery.ai/skills/anthropics/skill-creator',
      },
    ],
  });

  assert.equal(needs.every((need) => need.scaffold?.qualifiedName === 'anthropics/skill-creator'), true);
  assert.equal(needs.every((need) => need.scaffold?.usage === 'structure_and_rubric_seed'), true);
});
