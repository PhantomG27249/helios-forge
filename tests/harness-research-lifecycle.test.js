import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createResearchBrief } from '../src/harness-sidecar/research/researchBrief.js';
import { discoverSources } from '../src/harness-sidecar/research/sourceDiscovery.js';
import { ingestSources } from '../src/harness-sidecar/research/sourceIngestion.js';
import { findContradictions } from '../src/harness-sidecar/research/contradictionFinder.js';
import { createImplementationHandoff } from '../src/harness-sidecar/research/implementationHandoff.js';

test('research brief generation structures task, scope, and budget', () => {
  const brief = createResearchBrief({
    task: 'Plan source lifecycle primitives',
    question: 'How should deep research sources move into implementation?',
    scope: {
      include: ['local files', 'supplied source list'],
      exclude: ['web browsing'],
    },
    budget: {
      maxSources: 5,
      maxMinutes: 20,
    },
  });

  assert.match(brief.briefId, /^brief_/);
  assert.equal(brief.task, 'Plan source lifecycle primitives');
  assert.equal(brief.question, 'How should deep research sources move into implementation?');
  assert.deepEqual(brief.scope.include, ['local files', 'supplied source list']);
  assert.deepEqual(brief.scope.exclude, ['web browsing']);
  assert.equal(brief.budget.maxSources, 5);
  assert.equal(brief.status, 'ready_for_discovery');
});

test('external source discovery requires approval by default', () => {
  const discovery = discoverSources({
    brief: { briefId: 'brief_1' },
    externalQueries: ['latest benchmark guidance'],
  });

  assert.equal(discovery.status, 'approval_required');
  assert.equal(discovery.requiresApproval, true);
  assert.equal(discovery.approval.reason, 'external_discovery_requested');
  assert.deepEqual(discovery.sources, []);
});

test('source ingestion normalizes supplied sources and extracts claim candidates', () => {
  const ingestion = ingestSources({
    sources: [
      {
        sourceId: 'plan',
        title: 'Lifecycle plan',
        path: 'docs/lifecycle.md',
        content: 'Research briefs define scope. External discovery requires approval.',
      },
    ],
  });

  assert.deepEqual(ingestion.sourceMap, [
    {
      sourceId: 'plan',
      title: 'Lifecycle plan',
      type: 'local',
      path: 'docs/lifecycle.md',
      locator: 'docs/lifecycle.md',
    },
  ]);
  assert.equal(ingestion.claimCandidates.length, 2);
  assert.equal(ingestion.claimCandidates[0].sourceId, 'plan');
  assert.equal(ingestion.claimCandidates[0].claim, 'Research briefs define scope.');
});

test('contradiction finder detects conflicting claims on the same subject and predicate', () => {
  const contradictions = findContradictions({
    claims: [
      {
        claimId: 'c1',
        subject: 'external discovery',
        predicate: 'requires approval',
        value: true,
        evidence: ['src_1'],
      },
      {
        claimId: 'c2',
        subject: 'External Discovery',
        predicate: 'requires approval',
        value: false,
        evidence: ['src_2'],
      },
    ],
  });

  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0].subject, 'external discovery');
  assert.equal(contradictions[0].predicate, 'requires approval');
  assert.deepEqual(contradictions[0].claimIds, ['c1', 'c2']);
});

test('implementation handoff includes action items, uncertainty, and contradictions', () => {
  const handoff = createImplementationHandoff({
    report: {
      question: 'What should deep research build?',
      claimEvidenceTable: [
        {
          claimId: 'c1',
          claim: 'External discovery requires approval.',
          confidence: 0.9,
          evidence: ['src_1'],
        },
        {
          claimId: 'c2',
          claim: 'Claim extraction may miss nuanced prose.',
          confidence: 0.45,
          evidence: ['src_2'],
        },
      ],
    },
    contradictions: [
      {
        contradictionId: 'contra_1',
        subject: 'external discovery',
        predicate: 'requires approval',
        claimIds: ['c1', 'c3'],
      },
    ],
  });

  assert.equal(handoff.status, 'ready_with_cautions');
  assert.equal(handoff.actionItems.length, 2);
  assert.match(handoff.actionItems[0].task, /External discovery requires approval/);
  assert.equal(handoff.uncertainties[0].claimId, 'c2');
  assert.equal(handoff.contradictions[0].contradictionId, 'contra_1');
});
