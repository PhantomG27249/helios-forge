import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSoulMarkdown, sanitizePromptAdapterNotes } from '../src/harness-sidecar/souls/soulMarkdown.js';

const VALID_SOUL = `# Soul: implementer

## Identity
- Name: Builder
- Kind: deterministic_subagent
- Role: implementer
- Version: 1

## Mission
Make scoped changes with strong verification.

## Temperament
- Reasoning style: concrete

## Values And Invariants
- Must preserve: verifier evidence

## Capability Affinities
- Strong tools: shell

## Risk Posture
- Workspace write risk: low

## Memory Anchors
- Prior wins: focused fixes

## Evolution Genome
- Mutation family: implementation

## Evaluation History
- Current score summary: baseline

## Prompt Adapter Notes
Prefer small patches. token=secret C:\\Users\\jackj\\secret <script>alert(1)</script>
`;

const VALID_OVERSOUL = `# Oversoul: helios

## Identity
- Name: Helios
- Version: 1
- Active Soul Families: implementer, reviewer

## Collective Mission
Coordinate specialist agents.

## Shared Values And Invariants
- Must preserve: no self approval

## Role Ecology
- Core roles: implementer, reviewer
- Missing roles: visual

## Strategy Posture
- Exploration pressure: medium
- Evidence threshold: high

## Mutation Policy
- Allowed mutation families: distill

## Collective Memory Anchors
- Frontier wins: none

## Governance Posture
- Autonomy level: advisory

## Evaluation Summary
- Current frontier: baseline

## Prompt Adapter Notes
Keep changes evidence-only.
`;

test('parseSoulMarkdown parses strict soul contract and sanitizes prompt notes', () => {
  const parsed = parseSoulMarkdown(VALID_SOUL);

  assert.equal(parsed.kind, 'soul');
  assert.equal(parsed.id, 'implementer');
  assert.equal(parsed.version, '1');
  assert.equal(parsed.sections.Identity.includes('Name: Builder'), true);
  assert.match(parsed.promptAdapterNotes, /Prefer small patches/);
  assert.doesNotMatch(parsed.promptAdapterNotes, /token=secret/);
  assert.doesNotMatch(parsed.promptAdapterNotes, /C:\\Users/);
  assert.doesNotMatch(parsed.promptAdapterNotes, /script/);
});

test('parseSoulMarkdown parses oversoul contract', () => {
  const parsed = parseSoulMarkdown(VALID_OVERSOUL);

  assert.equal(parsed.kind, 'oversoul');
  assert.equal(parsed.id, 'helios');
  assert.equal(parsed.version, '1');
  assert.match(parsed.sections['Role Ecology'], /Core roles/);
});

test('parseSoulMarkdown rejects missing required sections', () => {
  assert.throws(
    () => parseSoulMarkdown('# Soul: broken\n\n## Identity\n- Version: 1\n'),
    /Missing required soul section: Mission/,
  );
});

test('sanitizePromptAdapterNotes strips secrets, absolute paths, raw html, and clamps length', () => {
  const sanitized = sanitizePromptAdapterNotes(`keep\nAuthorization: Bearer abc\nD:\\tmp\\x\n<div>bad</div>\n${'x'.repeat(5000)}`, {
    maxChars: 80,
  });

  assert.match(sanitized, /keep/);
  assert.doesNotMatch(sanitized, /Bearer/);
  assert.doesNotMatch(sanitized, /D:\\/);
  assert.doesNotMatch(sanitized, /div/);
  assert.equal(sanitized.length <= 80, true);
});
