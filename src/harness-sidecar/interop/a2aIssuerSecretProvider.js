function normalizeLookup({ keyRef, issuerId } = {}) {
  return {
    keyRef: keyRef ? String(keyRef).trim() : '',
    issuerId: issuerId ? String(issuerId).trim() : '',
  };
}

function normalizeEnvKey(value = '') {
  const suffix = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return suffix ? `HELIOS_A2A_ISSUER_SECRET_${suffix}` : '';
}

function firstString(values = []) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function lookupFromSecretStore(secretStore, lookup) {
  if (!secretStore) return undefined;
  if (typeof secretStore === 'function') return secretStore(lookup);
  if (typeof secretStore.loadIssuerSecret === 'function') {
    return secretStore.loadIssuerSecret(lookup);
  }
  if (typeof secretStore.load === 'function') return secretStore.load(lookup);
  if (typeof secretStore.get === 'function') {
    return firstString([
      lookup.keyRef ? secretStore.get(lookup.keyRef) : undefined,
      lookup.issuerId ? secretStore.get(lookup.issuerId) : undefined,
      secretStore.get('issuerSecret'),
      secretStore.get('default'),
    ]);
  }
  if (secretStore && typeof secretStore === 'object') {
    const issuerSecrets = secretStore.issuerSecrets && typeof secretStore.issuerSecrets === 'object'
      ? secretStore.issuerSecrets
      : {};
    return firstString([
      lookup.keyRef ? issuerSecrets[lookup.keyRef] : undefined,
      lookup.issuerId ? issuerSecrets[lookup.issuerId] : undefined,
      lookup.keyRef ? secretStore[lookup.keyRef] : undefined,
      lookup.issuerId ? secretStore[lookup.issuerId] : undefined,
      secretStore.issuerSecret,
      secretStore.default,
    ]);
  }
  return undefined;
}

function lookupFromEnv(env = {}, lookup) {
  if (!env || typeof env !== 'object') return undefined;
  return firstString([
    lookup.keyRef ? env[normalizeEnvKey(lookup.keyRef)] : undefined,
    lookup.issuerId ? env[normalizeEnvKey(lookup.issuerId)] : undefined,
    lookup.keyRef ? undefined : env.HELIOS_A2A_ISSUER_SECRET,
  ]);
}

function lookupFallback(fallback, lookup) {
  if (typeof fallback === 'function') return fallback(lookup);
  return typeof fallback === 'string' && fallback.length > 0 ? fallback : undefined;
}

function sourceFor({ secretStore, env, fallback, lookup }) {
  if (lookupFromSecretStore(secretStore, lookup)) return 'secretStore';
  if (lookupFromEnv(env, lookup)) return 'env';
  if (lookupFallback(fallback, lookup)) return 'fallback';
  return 'missing';
}

export function createIssuerSecretProvider({ env = {}, secretStore, fallback } = {}) {
  function getIssuerSecret(options = {}) {
    const lookup = normalizeLookup(options);
    return firstString([
      lookupFromSecretStore(secretStore, lookup),
      lookupFromEnv(env, lookup),
      lookupFallback(fallback, lookup),
    ]);
  }

  function hasIssuerSecret(options = {}) {
    return Boolean(getIssuerSecret(options));
  }

  function describe(options = {}) {
    const lookup = normalizeLookup(options);
    return {
      type: 'a2a_issuer_secret_provider',
      keyRef: lookup.keyRef || undefined,
      issuerId: lookup.issuerId || undefined,
      available: hasIssuerSecret(lookup),
      source: sourceFor({ secretStore, env, fallback, lookup }),
      redacted: true,
    };
  }

  return {
    getIssuerSecret,
    loadIssuerSecret: getIssuerSecret,
    hasIssuerSecret,
    describe,
    toJSON: () => describe(),
    toString: () => '[IssuerSecretProvider redacted]',
  };
}
