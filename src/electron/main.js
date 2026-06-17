/**
 * Electron Main Process
 *
 * Wraps the Helios Forge web interface in a desktop application.
 * Runs the Node.js server internally and opens a BrowserWindow.
 */

import { fork } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAppPaths } from './appPaths.js';
import {
  ensureWorkspaceReady,
  loadOnboardingState,
  saveOnboardingState,
} from './onboarding.js';
import { allocateLoopbackPort } from './portAllocator.js';
import { checkPiPrerequisites } from './piPrerequisites.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverReadyText = 'Listening on http://';

let mainWindow;
let serverProcess;
let runtimeState = {
  port: 3777,
  paths: null,
  workspaceRoot: null,
  piStatus: null,
  appUrl: 'http://127.0.0.1:3777/',
};

function loadElectron() {
  const electron = require('electron');
  if (!electron || typeof electron === 'string') {
    throw new Error('Electron APIs are only available in the Electron main process');
  }
  return electron;
}

export async function waitForServerReady(url, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`Server returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw lastError || new Error(`Timed out waiting for ${url}`);
}

export async function createRuntimePlan({
  isPackaged = false,
  appPath = path.resolve(__dirname, '..', '..'),
  resourcesPath = path.resolve(__dirname, '..', '..'),
  dirname = __dirname,
  allocateLoopbackPort: allocate = allocateLoopbackPort,
  preferredPort = 0,
} = {}) {
  const paths = resolveAppPaths({ isPackaged, appPath, resourcesPath, dirname });
  const port = await allocate(preferredPort);
  return {
    paths,
    port,
    appUrl: `http://127.0.0.1:${port}/`,
  };
}

function assertServerSpawnPrerequisites({ serverPath, cwd }) {
  const cwdStat = statSync(cwd, { throwIfNoEntry: false });
  if (!cwdStat?.isDirectory()) {
    throw new Error(
      `Embedded server working directory must be a real directory, not ${cwd}. ` +
      'Reinstall the desktop app if packaged resources are missing.',
    );
  }

  if (!existsSync(serverPath)) {
    throw new Error(`Embedded server entry not found: ${serverPath}`);
  }
}

export function startServer({
  forkFn = fork,
  port = '3777',
  cwd,
  serverPath,
  env = process.env,
  log = console,
  readyTimeoutMs = 15000,
  paths = runtimeState.paths,
} = {}) {
  const resolvedCwd = cwd || paths?.appRoot || path.resolve(__dirname, '..', '..');
  const resolvedServerPath = serverPath || paths?.serverEntry || path.join(resolvedCwd, 'src', 'server.js');
  assertServerSpawnPrerequisites({ serverPath: resolvedServerPath, cwd: resolvedCwd });

  return new Promise((resolve, reject) => {
    let settled = false;
    const readyDeadline = Date.now() + readyTimeoutMs;

    function finish(error, child) {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve(child);
      }
    }

    const child = forkFn(resolvedServerPath, [], {
      cwd: resolvedCwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    serverProcess = child;

    child.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        log.log(output);
      }
      if (output.includes(serverReadyText)) {
        finish(null, child);
      }
    });

    const readyTimer = setInterval(() => {
      if (settled) {
        clearInterval(readyTimer);
        return;
      }
      if (Date.now() >= readyDeadline) {
        clearInterval(readyTimer);
        finish(new Error(`Timed out waiting for embedded server on port ${port}`));
      }
    }, 100);

    child.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        log.error(output);
      }
    });

    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => {
      if (!settled) {
        finish(new Error(`Server exited before it was ready (code ${code ?? 'null'}, signal ${signal ?? 'null'})`));
      }
    });

    // Only trust readiness from this child process stdout. A generic HTTP poll can
    // succeed against another dev server already bound to the same port.
  });
}

export function stopServer(child = serverProcess) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      if (child === serverProcess) serverProcess = null;
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, 2000);
    child.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill();
    if (child === serverProcess) {
      serverProcess = null;
    }
  });
}

export async function resolveStartupWorkspace({
  app,
  dialog,
  userDataDir,
  loadOnboardingState: loadState = loadOnboardingState,
  saveOnboardingState: saveState = saveOnboardingState,
  ensureWorkspaceReady: ensureReady = ensureWorkspaceReady,
  bundledPackageRoot,
  defaultPath,
} = {}) {
  const onboarding = await loadState(userDataDir);
  let workspaceRoot = onboarding.workspaceRoot || defaultPath || app.getPath('documents');

  if (!onboarding.completed || !onboarding.workspaceRoot) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Helios Forge workplace',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: workspaceRoot,
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true };
    }
    workspaceRoot = result.filePaths[0];
  }

  const setup = await ensureReady({
    workspaceRoot,
    bundledPackageRoot,
  });

  await saveState(userDataDir, {
    completed: true,
    workspaceRoot: setup.workspaceRoot,
    lastSetupAt: new Date().toISOString(),
  });

  return {
    canceled: false,
    workspaceRoot: setup.workspaceRoot,
    setup,
  };
}

function createWindow({ BrowserWindow, appUrl, paths, title = 'Helios Forge' }) {
  const iconPath = path.join(paths.publicDir, 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: paths.preloadPath,
    },
  });

  mainWindow.loadURL(appUrl);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export async function startDesktopRuntime(electron, deps = {}) {
  const { app, BrowserWindow, dialog } = electron;
  const {
    createRuntimePlan: createPlan = createRuntimePlan,
    startServer: startServerImpl = startServer,
    checkPiPrerequisites: checkPi = checkPiPrerequisites,
    resolveStartupWorkspace: resolveWorkspace = resolveStartupWorkspace,
    preferredPort = 0,
  } = deps;

  const plan = await createPlan({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    dirname: __dirname,
    preferredPort,
  });

  runtimeState.paths = plan.paths;
  runtimeState.port = plan.port;
  runtimeState.appUrl = plan.appUrl;
  runtimeState.piStatus = checkPi();

  const workspace = await resolveWorkspace({
    app,
    dialog,
    userDataDir: app.getPath('userData'),
    bundledPackageRoot: plan.paths.bundledHarnessPackage,
    defaultPath: app.getPath('documents'),
  });

  if (workspace.canceled) {
    app.quit();
    return;
  }

  runtimeState.workspaceRoot = workspace.workspaceRoot;
  await startServerImpl({ port: plan.port, paths: plan.paths });
  createWindow({ BrowserWindow, appUrl: plan.appUrl, paths: plan.paths });
}

async function initialize(electron) {
  try {
    await startDesktopRuntime(electron);
  } catch (error) {
    console.error('Failed to start:', error);
    electron.app.quit();
  }
}

export function registerElectronApp(electron = loadElectron()) {
  const { app, BrowserWindow, ipcMain, dialog } = electron;

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => initialize({ app, BrowserWindow, dialog }));

  app.on('before-quit', () => {
    stopServer();
  });

  app.on('window-all-closed', () => {
    stopServer();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && runtimeState.paths) {
      createWindow({
        BrowserWindow,
        appUrl: runtimeState.appUrl,
        paths: runtimeState.paths,
      });
    }
  });

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('get-runtime-info', () => ({
    port: runtimeState.port,
    appUrl: runtimeState.appUrl,
    workspaceRoot: runtimeState.workspaceRoot,
    piStatus: runtimeState.piStatus,
    isPackaged: app.isPackaged,
  }));

  ipcMain.handle('check-pi-prerequisites', () => {
    runtimeState.piStatus = checkPiPrerequisites();
    return runtimeState.piStatus;
  });

  ipcMain.handle('run-onboarding', async (_event, workspaceRoot) => {
    const result = await ensureWorkspaceReady({
      workspaceRoot,
      bundledPackageRoot: runtimeState.paths?.bundledHarnessPackage,
    });
    runtimeState.workspaceRoot = result.workspaceRoot;
    await saveOnboardingState(app.getPath('userData'), {
      completed: true,
      workspaceRoot: result.workspaceRoot,
      lastSetupAt: new Date().toISOString(),
    });
    return result;
  });

  ipcMain.handle('select-workspace', async (_event, initialDirectory) => {
    const options = {
      title: 'Select Helios Forge workplace',
      properties: ['openDirectory', 'createDirectory'],
    };
    if (initialDirectory) options.defaultPath = initialDirectory;

    const result = await dialog.showOpenDialog(mainWindow, options);
    if (result.canceled || !result.filePaths?.[0]) {
      return { selected: false };
    }
    return { selected: true, path: result.filePaths[0] };
  });
}

export function shouldAutoRegisterElectronApp({ versions = process.versions } = {}) {
  return Boolean(versions?.electron);
}

if (shouldAutoRegisterElectronApp()) {
  registerElectronApp();
}
