import { join } from 'node:path';

import { createJsonFileA2ADurableStore } from './a2aDurableStore.js';

function assertStore(store = {}) {
  if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') {
    throw new Error('A2A queue provider store must expose load() and save(state)');
  }
}

export function createA2AQueueProvider({
  workspaceRoot,
  root,
  path,
  store,
  backend = 'json-file',
} = {}) {
  if (store) {
    assertStore(store);
    return {
      backend: 'injected',
      load: () => store.load(),
      save: (state) => store.save(state),
    };
  }

  if (backend !== 'json-file') {
    throw new Error(`Unsupported A2A queue provider backend: ${backend}`);
  }
  const queueRoot = root || (workspaceRoot ? join(workspaceRoot, '.harness', 'a2a') : null);
  if (!queueRoot) throw new Error('A2A queue provider requires workspaceRoot or root');
  const queuePath = path || join(queueRoot, 'queue-state.json');
  const containmentRoot = workspaceRoot && !root ? workspaceRoot : queueRoot;
  const durableStore = createJsonFileA2ADurableStore({ root: containmentRoot, path: queuePath });

  return {
    backend,
    root: queueRoot,
    path: queuePath,
    load: () => durableStore.load(),
    save: (state) => durableStore.save(state),
  };
}
