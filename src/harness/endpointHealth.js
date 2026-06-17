import { buildVllmHealthUrls } from '../harness-sidecar/model/vllmHealthController.js';

function boundedString(value, limit = 256) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, limit);
}

async function fetchWithTimeout(url, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function testEndpointProfile(profile = {}, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const baseUrl = boundedString(profile.baseUrl, 512);
  const modelId = boundedString(profile.modelId ?? profile.model, 256);
  if (!baseUrl || !modelId) {
    return {
      healthy: false,
      reason: 'missing_base_url_or_model_id',
      baseUrl,
      modelId,
    };
  }

  const urls = buildVllmHealthUrls(baseUrl);
  const checkedAt = new Date().toISOString();
  const result = {
    healthy: false,
    baseUrl,
    modelId,
    healthUrl: urls.healthUrl,
    modelsUrl: urls.modelsUrl,
    checkedAt,
  };

  if (urls.healthUrl) {
    try {
      const healthResponse = await fetchWithTimeout(urls.healthUrl, { timeoutMs, fetchImpl });
      if (healthResponse.ok) {
        result.healthy = true;
        result.reason = 'health_ok';
        return result;
      }
      result.reason = `health_status_${healthResponse.status}`;
    } catch (error) {
      result.reason = error.name === 'AbortError' ? 'health_timeout' : 'health_fetch_failed';
      result.error = boundedString(error.message, 160);
    }
  }

  if (urls.modelsUrl) {
    try {
      const modelsResponse = await fetchWithTimeout(urls.modelsUrl, { timeoutMs, fetchImpl });
      if (!modelsResponse.ok) {
        result.reason = result.reason || `models_status_${modelsResponse.status}`;
        return result;
      }
      const payload = await modelsResponse.json();
      const models = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
          ? payload.models
          : [];
      const ids = models.map((entry) => boundedString(entry?.id ?? entry?.model, 256)).filter(Boolean);
      result.modelListed = ids.includes(modelId);
      if (ids.length && !result.modelListed) {
        result.healthy = false;
        result.reason = 'model_not_listed';
        return result;
      }
      result.healthy = true;
      result.reason = result.reason === 'health_ok' ? 'health_and_models_ok' : 'models_ok';
      return result;
    } catch (error) {
      result.reason = result.reason || (error.name === 'AbortError' ? 'models_timeout' : 'models_fetch_failed');
      result.error = boundedString(error.message, 160);
      return result;
    }
  }

  return result;
}
