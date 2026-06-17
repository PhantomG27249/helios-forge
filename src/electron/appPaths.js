import path from 'node:path';

export function resolveAppPaths({
  isPackaged = false,
  appPath,
  resourcesPath,
  dirname,
} = {}) {
  if (!dirname) {
    throw new Error('resolveAppPaths requires dirname');
  }

  const devRoot = path.resolve(dirname, '..', '..');
  const appRoot = isPackaged ? appPath : devRoot;
  const resolvedResources = resourcesPath || devRoot;
  const bundledHarnessPackage = isPackaged
    ? path.join(resolvedResources, 'helios-research-harness')
    : path.join(devRoot, 'packages', 'helios-research-harness');

  return {
    appRoot,
    serverEntry: path.join(appRoot, 'src', 'server.js'),
    publicDir: path.join(appRoot, 'public'),
    preloadPath: path.join(dirname, 'preload.js'),
    bundledHarnessPackage,
  };
}
