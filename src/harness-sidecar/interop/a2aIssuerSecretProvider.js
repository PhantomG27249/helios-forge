function readStoreSecret(store, key) {
  if (!store) return undefined;
  if (typeof store === 'function') return store(key);
  if (typeof store.loadIssuerSecret === 'function') return store.loadIssuerSecret(key);
  if (typeof store.get === 'function') return store.get(key);
  if (typeof store.load === 'function') return store.load(key);
  if (typeof store.issuerSecret === 'string') return store.issuerSecret;
  return undefined;
}

function stableString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function createA2AIssuerSecretProvider({
  issuerSecret,
  issuerKeyRef = 'helios.local.a2a',
  env = globalThis.process?.env || {},
  envKey = 'HELIOS_A2A_ISSUER_SECRET',
  store,
  requireStable = false,
} = {}) {
  const keyRef = stableString(issuerKeyRef) || 'helios.local.a2a';

  function resolve() {
    const explicit = stableString(issuerSecret);
    if (explicit) return { secret: explicit, source: 'explicit' };
    const envSecret = stableString(env?.[envKey]);
    if (envSecret) return { secret: envSecret, source: 'env' };
    const storeSecret = stableString(readStoreSecret(store, keyRef) ?? readStoreSecret(store, 'issuerSecret'));
    if (storeSecret) return { secret: storeSecret, source: 'store' };
    if (requireStable) throw new Error('stable A2A issuer secret is required');
    return { secret: undefined, source: 'missing' };
  }

  return {
    loadIssuerSecret() {
      return resolve().secret;
    },
    get(key) {
      if (String(key || '') === keyRef || String(key || '') === 'issuerSecret') return resolve().secret;
      return undefined;
    },
    describe() {
      const resolved = resolve();
      return {
        issuerKeyRef: keyRef,
        source: resolved.source,
        stable: Boolean(resolved.secret),
      };
    },
  };
}
