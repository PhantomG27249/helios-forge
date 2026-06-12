import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  summarizeVisualFrontier,
  updateVisualFrontier,
} from '../src/harness-sidecar/meta/visualFrontier.js';
import { proposeVisualPolicies } from '../src/harness-sidecar/meta/visualPolicyEvolution.js';

test('visual frontier records evidence-only updates and keeps failed evidence as hard cases', () => {
  const frontier = updateVisualFrontier({
    frontier: [],
    replayReport: {
      suiteId: 'visual-prod',
      candidateId: 'candidate-a',
      summary: { averageScore: 0.72, averageConfidence: 0.66, failedEvidenceCount: 1 },
      metrics: {
        byKind: {
          ui_regression: { averageScore: 0.8, averageConfidence: 0.7, failedEvidenceCount: 0 },
          ocr: { averageScore: 0.4, averageConfidence: 0.48, failedEvidenceCount: 1 },
        },
      },
      hardCases: [{ caseId: 'ocr-case', reason: 'visual_false_negative', benchmarkKind: 'ocr' }],
    },
    now: () => new Date('2026-06-12T12:30:00.000Z'),
  });

  assert.equal(frontier.length, 1);
  assert.equal(frontier[0].candidateId, 'candidate-a');
  assert.equal(frontier[0].visualEvidenceRequired, true);
  assert.equal(frontier[0].evidenceOnly, true);
  assert.equal(frontier[0].canPromote, false);
  assert.equal(frontier[0].hardCases[0].caseId, 'ocr-case');
  assert.equal(frontier[0].metrics.failedEvidenceCount, 1);
});

test('visual frontier quarantines hard cases before dashboard summaries', () => {
  const frontier = updateVisualFrontier({
    frontier: [],
    replayReport: {
      suiteId: 'visual-prod',
      candidateId: 'candidate-secret',
      summary: { averageScore: 0.4, averageConfidence: 0.3, failedEvidenceCount: 1 },
      hardCases: [{
        caseId: 'unsafe-case',
        reason: 'visual_false_negative',
        artifactPath: 'C:\\Users\\jackj\\secret.png',
        note: 'api_key=sk-frontier-secret',
      }],
    },
  });
  const summary = summarizeVisualFrontier(frontier);
  const visible = JSON.stringify(summary);

  assert.equal(visible.includes('C:\\Users'), false);
  assert.equal(visible.includes('sk-frontier-secret'), false);
  assert.equal(summary.frontier[0].hardCases[0].artifactPath, '[redacted:path]');
  assert.equal(summary.frontier[0].hardCases[0].note, 'api_key=[redacted]');
});

test('visual frontier quarantines hard cases from existing frontier entries', () => {
  const frontier = updateVisualFrontier({
    frontier: [{
      suiteId: 'visual-prod',
      candidateId: 'candidate-existing',
      metrics: { averageScore: 0.9, averageConfidence: 0.9, failedEvidenceCount: 0 },
      hardCases: [{
        caseId: 'existing-unsafe',
        artifactPath: 'C:\\Users\\jackj\\secret.png',
        note: 'api_key=sk-frontier-secret',
      }],
    }],
    replayReport: {
      suiteId: 'visual-prod',
      candidateId: 'candidate-new',
      summary: { averageScore: 0.3, averageConfidence: 0.3, failedEvidenceCount: 2 },
      hardCases: [],
    },
  });
  const visible = JSON.stringify(frontier);

  assert.equal(visible.includes('C:\\Users'), false);
  assert.equal(visible.includes('sk-frontier-secret'), false);
  assert.equal(frontier[0].hardCases[0].artifactPath, '[redacted:path]');
  assert.equal(frontier[0].hardCases[0].note, 'api_key=[redacted]');
});

test('visual frontier replaces dominated candidates and feeds policy evolution hard cases', () => {
  const first = updateVisualFrontier({
    frontier: [],
    replayReport: {
      suiteId: 'visual-prod',
      candidateId: 'candidate-a',
      summary: { averageScore: 0.55, averageConfidence: 0.6, failedEvidenceCount: 2 },
      metrics: { byKind: { chart: { averageScore: 0.55, averageConfidence: 0.6, failedEvidenceCount: 2 } } },
      hardCases: [{ caseId: 'chart-hard', reason: 'visual_false_negative', visualCase: { benchmarkKind: 'chart', caseId: 'chart-hard' } }],
    },
  });
  const second = updateVisualFrontier({
    frontier: first,
    replayReport: {
      suiteId: 'visual-prod',
      candidateId: 'candidate-b',
      summary: { averageScore: 0.85, averageConfidence: 0.82, failedEvidenceCount: 0 },
      metrics: { byKind: { chart: { averageScore: 0.85, averageConfidence: 0.82, failedEvidenceCount: 0 } } },
      hardCases: [],
    },
  });
  const summary = summarizeVisualFrontier(second);

  assert.deepEqual(second.map((entry) => entry.candidateId), ['candidate-b']);
  assert.equal(summary.frontierCount, 1);
  assert.equal(summary.bestCandidateId, 'candidate-b');
  assert.equal(summary.evidenceOnly, true);
  assert.equal(summary.canPromote, false);

  const [policy] = proposeVisualPolicies({ coreset: first[0].hardCases });
  assert.equal(policy.hardCaseReasons.includes('visual_false_negative'), true);
  assert.equal(policy.status, 'shadow_only');
  assert.equal(policy.visualEvidenceRequired, true);
  assert.equal(policy.evidenceOnly, true);
  assert.equal(policy.canPromote, false);
  assert.equal(policy.authority, 'visual_evidence_only');
});

test('visual policy BES lane keeps safety fields after candidate overrides', async () => {
  const { runVisualPolicyBesLane } = await import('../src/harness-sidecar/meta/visualPolicyEvolution.js');
  const result = await runVisualPolicyBesLane({
    coreset: [{
      caseId: 'visual-hard',
      reason: 'visual_false_negative',
      visualCase: { caseId: 'visual-hard', benchmarkKind: 'chart' },
    }],
    candidateOverrides: [{
      visualEvidenceRequired: false,
      evidenceOnly: false,
      authority: 'root',
      canPromote: true,
      status: 'approved',
      promotable: true,
      safety: { status: 'unsafe', canPromote: true },
    }],
  });
  const candidate = result.candidates[0];

  assert.equal(candidate.visualEvidenceRequired, true);
  assert.equal(candidate.evidenceOnly, true);
  assert.equal(candidate.authority, 'visual_evidence_only');
  assert.equal(candidate.canPromote, false);
  assert.equal(candidate.status, 'shadow_only');
  assert.equal(candidate.promotable, false);
  assert.equal(candidate.safety.status, 'shadow_only');
  assert.equal(candidate.safety.canPromote, false);
});
