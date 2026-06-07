import { existsSync } from 'fs';
import path from 'path';

function pathEntries(env) {
  return String(env.Path || env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
}

function windowsCandidates(env) {
  const home = env.USERPROFILE || env.HOME || '';
  const names = ['pi.cmd', 'pi.exe', 'pi.bat', 'pi.ps1'];
  const fromPath = pathEntries(env).flatMap((entry) => names.map((name) => path.join(entry, name)));
  const localPiNode = home
    ? names.map((name) => path.join(home, 'AppData', 'Local', 'pi-node', 'current', name))
    : [];
  return [...fromPath, ...localPiNode];
}

function posixCandidates(env) {
  return pathEntries(env).map((entry) => path.join(entry, 'pi'));
}

export function resolvePiCommand({ env = process.env, platform = process.platform } = {}) {
  if (env.HELIOS_PI_COMMAND) {
    return {
      command: env.HELIOS_PI_COMMAND,
      args: [],
    };
  }

  const candidates = platform === 'win32' ? windowsCandidates(env) : posixCandidates(env);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) {
    const extension = path.extname(found).toLowerCase();
    if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
      return {
        command: env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', found],
      };
    }
    if (platform === 'win32' && extension === '.ps1') {
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', found],
      };
    }
    return {
      command: found,
      args: [],
    };
  }

  return {
    command: 'pi',
    args: [],
  };
}
