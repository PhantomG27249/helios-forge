import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { checkPiPrerequisites, isPiBinaryInstalled, piConfigDir } from '../src/electron/piPrerequisites.js';

test('checkPiPrerequisites reports missing pi and config files', () => {
  const status = checkPiPrerequisites({
    env: {},
    platform: 'win32',
    homedir: 'C:\\Users\\me',
    exists: () => false,
    resolvePiCommandImpl: () => ({ command: 'pi', args: [] }),
  });

  assert.equal(status.ok, false);
  assert.equal(status.piInstalled, false);
  assert.equal(status.piConfigDir, path.join('C:\\Users\\me', '.pi', 'agent'));
  assert.equal(status.modelsJsonPresent, false);
  assert.equal(status.authJsonPresent, false);
  assert.deepEqual(status.issues, ['pi_missing', 'models_json_missing', 'auth_json_missing']);
  assert.ok(status.guidance.length >= 3);
});

test('checkPiPrerequisites passes when pi binary and config exist', () => {
  const configDir = piConfigDir({ homedir: '/home/me' });
  const status = checkPiPrerequisites({
    env: { HELIOS_PI_COMMAND: '/usr/local/bin/pi' },
    platform: 'linux',
    homedir: '/home/me',
    exists: (target) => [
      '/usr/local/bin/pi',
      path.join(configDir, 'models.json'),
      path.join(configDir, 'auth.json'),
    ].includes(target),
    resolvePiCommandImpl: () => ({ command: '/usr/local/bin/pi', args: [] }),
  });

  assert.equal(status.ok, true);
  assert.equal(status.piInstalled, true);
  assert.deepEqual(status.issues, []);
});

test('isPiBinaryInstalled honors HELIOS_PI_COMMAND', () => {
  assert.equal(isPiBinaryInstalled({
    env: { HELIOS_PI_COMMAND: 'C:\\tools\\pi.exe' },
    platform: 'win32',
    exists: (target) => target === 'C:\\tools\\pi.exe',
  }), true);
});
