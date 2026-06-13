import {
  createJsonFileA2ADurableStore,
  sanitizeA2ADurableState,
} from './a2aDurableStore.js';

const DEFAULT_STATE = {
  outbox: [],
  inbox: [],
  streams: [],
  peerEndpoints: [],
};

function cloneSerializable(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function recordsFromState(records) {
  if (Array.isArray(records)) return records;
  if (records && typeof records === 'object') return Object.values(records);
  return [];
}

function normalizeQueueName(queueName = 'outbox') {
  const normalized = String(queueName || 'outbox').trim();
  if (!normalized || /[^A-Za-z0-9_.:-]/.test(normalized)) {
    throw new Error(`Invalid A2A queue name: ${queueName || '(empty)'}`);
  }
  return normalized;
}

function normalizeState(state = {}) {
  const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  return {
    ...source,
    outbox: recordsFromState(source.outbox),
    inbox: recordsFromState(source.inbox),
    streams: recordsFromState(source.streams),
    peerEndpoints: recordsFromState(source.peerEndpoints),
  };
}

function createMemoryStore() {
  let state = cloneSerializable(DEFAULT_STATE);
  return {
    load: () => cloneSerializable(state),
    save: (nextState) => {
      state = cloneSerializable(nextState);
      return cloneSerializable(state);
    },
  };
}

function normalizeDurableStore(durableStore) {
  if (!durableStore) return createMemoryStore();
  if (typeof durableStore.load === 'function' || typeof durableStore.save === 'function') {
    return durableStore;
  }
  if (typeof durableStore === 'object' && typeof durableStore.path === 'string') {
    return createJsonFileA2ADurableStore(durableStore);
  }
  throw new Error('A2A queue provider durableStore must expose load/save or JSON file configuration');
}

function normalizeAdapter(adapter, durableStore) {
  if (adapter) {
    if (typeof adapter.load !== 'function' && typeof adapter.save !== 'function') {
      throw new Error('A2A queue provider adapter must expose load or save');
    }
    return adapter;
  }
  return normalizeDurableStore(durableStore);
}

export function createA2aQueueProvider({ adapter, durableStore } = {}) {
  const store = normalizeAdapter(adapter, durableStore);

  function load() {
    const loaded = typeof store.load === 'function' ? store.load() : null;
    return cloneSerializable(sanitizeA2ADurableState(normalizeState(loaded || DEFAULT_STATE)));
  }

  function save(state = {}) {
    const sanitizedState = sanitizeA2ADurableState(normalizeState(state));
    if (typeof store.save === 'function') {
      store.save(cloneSerializable(sanitizedState));
    }
    return cloneSerializable(sanitizedState);
  }

  function list(queueName = 'outbox') {
    const queue = normalizeQueueName(queueName);
    return recordsFromState(load()[queue]).map((record) => cloneSerializable(record));
  }

  function enqueue(queueName = 'outbox', record = {}) {
    const queue = normalizeQueueName(queueName);
    const state = load();
    const queueRecords = recordsFromState(state[queue]);
    const sanitizedRecord = sanitizeA2ADurableState(record || {});
    state[queue] = [...queueRecords, sanitizedRecord];
    save(state);
    return cloneSerializable(sanitizedRecord);
  }

  function ack({
    queue: queueName = 'outbox',
    messageId,
    status = 'acknowledged',
    patch = {},
  } = {}) {
    const queue = normalizeQueueName(queueName);
    const id = String(messageId || '');
    if (!id) throw new Error('A2A queue ack requires messageId');
    const state = load();
    const queueRecords = recordsFromState(state[queue]);
    const index = queueRecords.findIndex((record) => String(record.messageId || '') === id);
    if (index === -1) throw new Error(`Unknown A2A queue message ${id}`);
    const updated = sanitizeA2ADurableState({
      ...queueRecords[index],
      ...patch,
      status,
    });
    queueRecords[index] = updated;
    state[queue] = queueRecords;
    save(state);
    return cloneSerializable(updated);
  }

  function describe() {
    return {
      type: 'a2a_queue_provider',
      adapter: Boolean(adapter),
      durable: Boolean(durableStore),
      redacted: true,
      queues: ['outbox', 'inbox', 'streams', 'peerEndpoints'],
    };
  }

  return {
    load,
    hydrate: load,
    save,
    list,
    enqueue,
    ack,
    describe,
    toJSON: describe,
    toString: () => '[A2AQueueProvider redacted]',
  };
}
