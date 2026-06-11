import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildVllmHealthUrls,
  createVllmHealthController,
} from '../src/harness-sidecar/model/vllmHealthController.js';

function deferred() {
  let resolve;
  const promise = new Promise((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

test('buildVllmHealthUrls derives vLLM health and models URLs from an OpenAI-compatible base URL', () => {
  assert.deepEqual(buildVllmHealthUrls('http://model.test:8000/v1'), {
    healthUrl: 'http://model.test:8000/health',
    modelsUrl: 'http://model.test:8000/v1/models',
  });
  assert.deepEqual(buildVllmHealthUrls('http://model.test:8000/api/v1/'), {
    healthUrl: 'http://model.test:8000/api/health',
    modelsUrl: 'http://model.test:8000/api/v1/models',
  });
});

test('vLLM health controller samples health concurrently and scales up while healthy', async () => {
  const releasePool = [deferred(), deferred(), deferred()];
  const releases = [...releasePool];
  const requestedUrls = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const controller = createVllmHealthController({
    baseUrl: 'http://model.test:8000/v1',
    initialConcurrency: 1,
    maxConcurrency: 4,
    probeConcurrency: 3,
    targetLatencyMs: 1000,
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const release = releases.shift();
      await release.promise;
      inFlight -= 1;
      return { ok: true, status: 200 };
    },
  });

  const probe = controller.probeAndUpdate();
  await Promise.resolve();
  assert.equal(maxInFlight, 3);
  releasePool.forEach((release) => release.resolve());

  const result = await probe;
  assert.deepEqual([...new Set(requestedUrls)], ['http://model.test:8000/health']);
  assert.equal(result.healthy, true);
  assert.equal(result.concurrency, 2);
  assert.equal(controller.getConcurrency(), 2);
});

test('vLLM health controller scales down on failed or slow probes', async () => {
  let failed = false;
  let now = 0;
  const controller = createVllmHealthController({
    baseUrl: 'http://model.test:8000/v1',
    initialConcurrency: 3,
    minConcurrency: 1,
    maxConcurrency: 4,
    probeConcurrency: 2,
    targetLatencyMs: 100,
    now: () => now,
    fetchImpl: async () => {
      const start = now;
      now = start + 250;
      return { ok: !failed, status: failed ? 503 : 200 };
    },
  });

  const slowResult = await controller.probeAndUpdate();
  assert.equal(slowResult.concurrency, 2);
  assert.equal(slowResult.reason, 'latency_high');

  failed = true;
  const failedResult = await controller.probeAndUpdate();
  assert.equal(failedResult.concurrency, 1);
  assert.equal(failedResult.reason, 'health_probe_failed');
  assert.equal(failedResult.healthy, false);
});
