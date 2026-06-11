import { createOpenAICompatibleProvider } from './openaiCompatibleProvider.js';

function safeRoute(route = {}) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) return null;
  const baseUrl = typeof route.baseUrl === 'string' ? route.baseUrl.trim() : '';
  const modelId = typeof route.modelId === 'string' ? route.modelId.trim() : '';
  if (!baseUrl || !modelId) return null;
  return {
    baseUrl,
    modelId,
    apiKey: route.apiKey,
    apiKeyEnv: typeof route.apiKeyEnv === 'string' ? route.apiKeyEnv.trim() : '',
  };
}

function apiKeyForRoute(route = {}) {
  if (route.apiKeyEnv && process.env[route.apiKeyEnv]) return process.env[route.apiKeyEnv];
  return route.apiKey || 'dummy';
}

export function createRoutingModelProvider({
  routes = {},
  defaultProvider,
  providerFactory = createOpenAICompatibleProvider,
} = {}) {
  const routeProviders = new Map();
  for (const [routeId, rawRoute] of Object.entries(routes || {})) {
    const route = safeRoute(rawRoute);
    if (!route || !routeId) continue;
    routeProviders.set(routeId, {
      route,
      provider: providerFactory({
        baseUrl: route.baseUrl,
        modelId: route.modelId,
        apiKey: apiKeyForRoute(route),
      }),
    });
  }

  return async function routingModelProvider(input = {}) {
    const profile = input.profile || {};
    const routeId = profile.name || profile.modelCouncilEndpointProfile;
    const endpointRouteId = profile.modelCouncilEndpointProfile;
    const selected = routeProviders.get(routeId) || routeProviders.get(endpointRouteId);
    if (!selected) {
      if (typeof defaultProvider === 'function') return defaultProvider(input);
      if (typeof defaultProvider?.call === 'function') return defaultProvider.call(input);
      throw new Error('Routing model provider has no matching route or default provider');
    }
    return selected.provider({
      ...input,
      profile: {
        ...profile,
        model: selected.route.modelId,
      },
    });
  };
}
