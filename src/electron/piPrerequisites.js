import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolvePiCommand } from '../pi/resolvePiCommand.js';

function pathEntries(env) {
  return String(env.Path || env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
}

function piBinaryCandidates(env, platform) {
  if (env.HELIOS_PI_COMMAND) {
    return [env.HELIOS_PI_COMMAND];
  }

  if (platform === 'win32') {
    const home = env.USERPROFILE || env.HOME || '';
    const names = ['pi.cmd', 'pi.exe', 'pi.bat', 'pi.ps1'];
    const fromPath = pathEntries(env).flatMap((entry) => names.map((name) => path.join(entry, name)));
    const localPiNode = home
      ? names.map((name) => path.join(home, 'AppData', 'Local', 'pi-node', 'current', name))
      : [];
    return [...fromPath, ...localPiNode];
  }

  return pathEntries(env).map((entry) => path.join(entry, 'pi'));
}

export function piConfigDir({ homedir = os.homedir() } = {}) {
  return path.join(homedir, '.pi', 'agent');
}

export function isPiBinaryInstalled({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  return piBinaryCandidates(env, platform).some((candidate) => exists(candidate));
}

export function checkPiPrerequisites({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  exists = existsSync,
  resolvePiCommandImpl = resolvePiCommand,
} = {}) {
  const configDir = piConfigDir({ homedir });
  const modelsJsonPresent = exists(path.join(configDir, 'models.json'));
  const authJsonPresent = exists(path.join(configDir, 'auth.json'));
  const settingsJsonPresent = exists(path.join(configDir, 'settings.json'));
  const piInstalled = isPiBinaryInstalled({ env, platform, exists });
  const piCommand = resolvePiCommandImpl({ env, platform });

  const issues = [];
  const guidance = [];

  if (!piInstalled) {
    issues.push('pi_missing');
    guidance.push('Install Pi Agent and ensure `pi` is on PATH (or set HELIOS_PI_COMMAND).');
  }

  if (!modelsJsonPresent) {
    issues.push('models_json_missing');
    guidance.push('Configure models in Pi settings (~/.pi/agent/models.json).');
  }

  if (!authJsonPresent) {
    issues.push('auth_json_missing');
    guidance.push('Add provider credentials in ~/.pi/agent/auth.json.');
  }

  return {
    ok: issues.length === 0,
    piInstalled,
    piCommand: piCommand.command,
    piConfigDir: configDir,
    modelsJsonPresent,
    authJsonPresent,
    settingsJsonPresent,
    issues,
    guidance,
  };
}
