import test from 'node:test';
import assert from 'node:assert/strict';

import { applySoulPromptContext, buildSoulPromptContext } from '../src/harness-sidecar/souls/soulPromptAdapter.js';
import { buildRolePrompt } from '../src/harness-sidecar/swarm/rolePrompts.js';

test('prompt adapter appends sanitized optional soul context without changing default role prompt behavior', () => {
  const baseline = buildRolePrompt({ role: 'implementer', task: { goal: 'fix it' } });
  const soulContext = buildSoulPromptContext({
    soul: {
      id: 'implementer',
      version: '2',
      promptAdapterNotes: 'Prefer verifier evidence. api_key=123 C:\\secret',
    },
    oversoul: {
      id: 'helios',
      version: '3',
      promptAdapterNotes: 'Favor reviewer balance.',
    },
  });
  const prompted = applySoulPromptContext(baseline, soulContext);

  assert.doesNotMatch(baseline.text, /Soul Context/);
  assert.match(prompted.text, /Soul Context/);
  assert.match(prompted.text, /soul=implementer@2/);
  assert.match(prompted.text, /oversoul=helios@3/);
  assert.match(prompted.text, /Prefer verifier evidence/);
  assert.doesNotMatch(prompted.text, /api_key/);
  assert.doesNotMatch(prompted.text, /C:\\/);
});
