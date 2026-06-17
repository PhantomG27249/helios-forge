import path from 'node:path';

export function resolvePackagedRuntimeRoot(appPath) {
  if (!appPath) {
    return appPath;
  }
  return appPath.replace(/app\.asar$/i, 'app.asar.unpacked');
}

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
  const resolvedResources = resourcesPath || devRoot;
  const asarAppPath = isPackaged ? appPath : devRoot;
  const appRoot = isPackaged ? resolvePackagedRuntimeRoot(appPath) : devRoot;
  const bundledHarnessPackage = isPackaged
    ? path.join(resolvedResources, 'helios-research-harness')
    : path.join(devRoot, 'packages', 'helios-research-harness');

  return {
    appRoot,
    asarAppPath,
    serverEntry: path.join(appRoot, 'src', 'server.js'),
    publicDir: path.join(asarAppPath, 'public'),
    preloadPath: path.join(dirname, 'preload.js'),
    bundledHarnessPackage,
  };
}
