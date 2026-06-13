function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function boundedString(value, limit = 160) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, limit);
}

function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

function stripOpenAIPath(baseUrl) {
  const url = new URL(baseUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[parts.length - 1] === 'v1') {
    parts.pop();
  }
  url.pathname = parts.length ? `/${parts.join('/')}` : '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function normalizeVllmHealthSnapshot(snapshot = {}) {
  const healthy = typeof snapshot?.healthy === 'boolean' ? snapshot.healthy : undefined;
  const concurrency = finiteNumber(snapshot?.concurrency, null);
  const p95LatencyMs = finiteNumber(snapshot?.p95LatencyMs, null);
  const failureCount = finiteNumber(snapshot?.failureCount, null);
  const sampleCount = finiteNumber(snapshot?.sampleCount, null);
  const normalized = {
    healthy,
    reason: boundedString(snapshot?.reason || (healthy === false ? 'health_probe_failed' : ''), 96) || undefined,
    concurrency: concurrency !== null ? Math.max(1, Math.floor(concurrency)) : undefined,
    p95LatencyMs: p95LatencyMs !== null ? Math.max(0, p95LatencyMs) : undefined,
    failureCount: failureCount !== null ? Math.max(0, Math.floor(failureCount)) : undefined,
    sampleCount: sampleCount !== null ? Math.max(0, Math.floor(sampleCount)) : undefined,
    checkedAt: boundedString(snapshot?.checkedAt, 64) || undefined,
  };
  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined),
  );
}

export function buildVllmHealthUrls(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    return { healthUrl: null, modelsUrl: null };
  }
  const serviceBaseUrl = stripOpenAIPath(normalizedBaseUrl);
  return {
    healthUrl: `${serviceBaseUrl}/health`,
    modelsUrl: `${normalizedBaseUrl}/models`,
  };
}

async function fetchWithTimeout({ fetchImpl, url, timeoutMs }) {
  if (typeof AbortController === 'undefined' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetchImpl(url);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function nextConcurrency({ current, min, max, healthy, p95LatencyMs, targetLatencyMs }) {
  if (!healthy) {
    return {
      concurrency: clamp(Math.floor(current / 2), min, max),
      reason: 'health_probe_failed',
    };
  }
  if (p95LatencyMs !== null && p95LatencyMs > targetLatencyMs) {
    return {
      concurrency: clamp(current - 1, min, max),
      reason: 'latency_high',
    };
  }
  if (current < max) {
    return {
      concurrency: clamp(current + 1, min, max),
      reason: 'healthy_capacity_available',
    };
  }
  return {
    concurrency: current,
    reason: 'at_max_concurrency',
  };
}

export function createVllmHealthController({
  baseUrl,
  fetchImpl = fetch,
  now = () => Date.now(),
  minConcurrency = 1,
  maxConcurrency = 4,
  initialConcurrency = minConcurrency,
  probeConcurrency = 2,
  timeoutMs = 1000,
  targetLatencyMs = 1000,
} = {}) {
  const urls = buildVllmHealthUrls(baseUrl);
  const min = Math.max(1, Math.floor(finiteNumber(minConcurrency, 1)));
  const max = Math.max(min, Math.floor(finiteNumber(maxConcurrency, 4)));
  let concurrency = clamp(Math.floor(finiteNumber(initialConcurrency, min)), min, max);
  let lastProbe = {
    baseUrl: normalizeBaseUrl(baseUrl),
    healthUrl: urls.healthUrl,
    modelsUrl: urls.modelsUrl,
    healthy: false,
    concurrency,
    reason: 'not_probed',
    checkedAt: null,
    sampleCount: 0,
    failureCount: 0,
    p95LatencyMs: null,
  };

  async function probeOnce() {
    const startedAt = now();
    try {
      const response = await fetchWithTimeout({ fetchImpl, url: urls.healthUrl, timeoutMs });
      const completedAt = now();
      return {
        ok: Boolean(response?.ok),
        status: response?.status || 0,
        latencyMs: Math.max(0, completedAt - startedAt),
      };
    } catch (error) {
      const completedAt = now();
      return {
        ok: false,
        status: 0,
        latencyMs: Math.max(0, completedAt - startedAt),
        error: error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error)),
      };
    }
  }

  return {
    getConcurrency() {
      return concurrency;
    },
    getLastProbe() {
      return { ...lastProbe };
    },
    async probeAndUpdate() {
      if (!urls.healthUrl) {
        lastProbe = {
          ...lastProbe,
          healthy: false,
          concurrency: min,
          reason: 'missing_base_url',
          checkedAt: new Date(now()).toISOString(),
        };
        concurrency = min;
        return { ...lastProbe };
      }

      const sampleCount = clamp(Math.floor(finiteNumber(probeConcurrency, 2)), 1, max);
      const samples = await Promise.all(Array.from({ length: sampleCount }, () => probeOnce()));
      const failureCount = samples.filter((sample) => !sample.ok).length;
      const healthy = failureCount === 0;
      const p95LatencyMs = p95(samples.map((sample) => sample.latencyMs));
      const decision = nextConcurrency({
        current: concurrency,
        min,
        max,
        healthy,
        p95LatencyMs,
        targetLatencyMs: finiteNumber(targetLatencyMs, 1000),
      });
      concurrency = decision.concurrency;
      lastProbe = {
        baseUrl: normalizeBaseUrl(baseUrl),
        healthUrl: urls.healthUrl,
        modelsUrl: urls.modelsUrl,
        healthy,
        concurrency,
        reason: decision.reason,
        checkedAt: new Date(now()).toISOString(),
        sampleCount,
        failureCount,
        p95LatencyMs,
        statuses: samples.map((sample) => sample.status),
      };
      return { ...lastProbe };
    },
  };
}
