import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import {
  selectHarnessWorkspaceRoot,
  shouldRecreateHarnessForWorkspace,
} from '../src/harness/workspaceSelection.js';

test('requested workspace root wins over pi cwd for harness runtime selection', () => {
  const selected = selectHarnessWorkspaceRoot({
    requestedWorkspaceRoot: 'C:/Users/jackj/Github/project-b',
    currentHarnessRoot: 'C:/Users/jackj/Github/project-a',
    piCwd: 'C:/Users/jackj/Github/project-a',
  });

  assert.equal(selected, path.resolve('C:/Users/jackj/Github/project-b'));
});

test('existing harness root wins over pi cwd when no explicit workspace is requested', () => {
  const selected = selectHarnessWorkspaceRoot({
    currentHarnessRoot: 'C:/Users/jackj/Github/project-b',
    piCwd: 'C:/Users/jackj/Github/project-a',
  });

  assert.equal(selected, path.resolve('C:/Users/jackj/Github/project-b'));
});

test('harness runtime is recreated when desired workspace differs', () => {
  assert.equal(
    shouldRecreateHarnessForWorkspace({
      currentWorkspaceRoot: 'C:/Users/jackj/Github/project-a',
      desiredWorkspaceRoot: 'C:/Users/jackj/Github/project-b',
    }),
    true,
  );
  assert.equal(
    shouldRecreateHarnessForWorkspace({
      currentWorkspaceRoot: 'C:/Users/jackj/Github/project-b',
      desiredWorkspaceRoot: 'C:/Users/jackj/Github/project-b',
    }),
    false,
  );
});
