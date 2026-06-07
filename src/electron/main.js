/**
 * Electron Main Process
 *
 * Wraps the Helios Forge web interface in a desktop application.
 * Runs the Node.js server internally and opens a BrowserWindow.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..', '..');
const serverReadyText = 'HTTP + WebSocket server on';

let mainWindow;
let serverProcess;

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

export function startServer({
  spawnFn = spawn,
  nodePath = process.execPath,
  port = '3777',
  cwd = appRoot,
  serverPath = path.join(appRoot, 'src', 'server.js'),
  env = process.env,
  log = console,
  waitForServerReady: waitForReady = waitForServerReady,
  readyTimeoutMs = 15000,
  readyIntervalMs = 100,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const readyUrl = `http://127.0.0.1:${port}/`;

    function finish(error, child) {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve(child);
      }
    }

    const child = spawnFn(nodePath, [serverPath], {
      cwd,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1', PORT: port },
      stdio: ['ignore', 'pipe', 'pipe'],
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

    waitForReady(readyUrl, { timeoutMs: readyTimeoutMs, intervalMs: readyIntervalMs })
      .then(() => finish(null, child))
      .catch((error) => finish(error));
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

function createWindow({ BrowserWindow }) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Helios Forge',
    icon: path.join(appRoot, 'public', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL('http://localhost:3777');

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initialize(electron) {
  try {
    await startServer();
    createWindow(electron);
  } catch (error) {
    console.error('Failed to start:', error);
    electron.app.quit();
  }
}

export function registerElectronApp(electron = loadElectron()) {
  const { app, BrowserWindow, ipcMain, dialog } = electron;

  app.whenReady().then(() => initialize({ app, BrowserWindow }));

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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ BrowserWindow });
    }
  });

  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('select-workspace', async (_event, initialDirectory) => {
    const options = {
      title: 'Select Helios Forge workspace',
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
