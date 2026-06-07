/**
 * Electron Preload Script
 * 
 * Exposes a minimal API to the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  selectWorkspace: (initialDirectory) => ipcRenderer.invoke('select-workspace', initialDirectory),
  isElectron: true,
});
