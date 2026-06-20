import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPostTaskCampaignBindings } from '../src/harness-sidecar/meta/postTaskCampaignBindings.js';

test('campaign bindings attach bes and rho evidence refs', async () => {
  const bindings = createPostTaskCampaignBindings({
    task: { taskId: 't1' },
    replayReports: [{
      reportId: 'replay-1',
      aggregateScore: 0.82,
      regressions: [],
    }],
  });
  const evaluation = await bindings.evaluator({ replayReport: { reportId: 'replay-1', aggregateScore: 0.82 } });
  assert.equal(evaluation.evidence.bes.advisoryScore, 0.82);
  assert.equal(evaluation.evidence.rho.reportId, 'replay-1');
  assert.equal(evaluation.evidence.bes.canPromote, false);
});
