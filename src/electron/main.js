/**
 * Electron Main Process
 * 
 * Wraps the Helios Forge web interface in a desktop application.
 * Runs the Node.js server internally and opens a BrowserWindow.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Helios Forge',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL('http://localhost:3777');
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    
    serverProcess = spawn('node', [serverPath], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: '3777' },
      stdio: ['inherit', 'inherit', 'pipe'],
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output.trim());
      
      if (output.includes('HTTP + WebSocket server on')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      reject(err);
    });

    // Timeout after 15 seconds
    setTimeout(() => {
      resolve(); // Assume server is up even if we didn't catch the message
    }, 15000);
  });
}

async function initialize() {
  try {
    await startServer();
    createWindow();
  } catch (err) {
    console.error('Failed to start:', err);
    app.quit();
  }
}

app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle IPC from preload
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});
