/**
 * Electron Preload Script
 *
 * Exposes a minimal API to the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  getRuntimeInfo: () => ipcRenderer.invoke('get-runtime-info'),
  selectWorkspace: (initialDirectory) => ipcRenderer.invoke('select-workspace', initialDirectory),
  runOnboarding: (workspaceRoot) => ipcRenderer.invoke('run-onboarding', workspaceRoot),
  checkPiPrerequisites: () => ipcRenderer.invoke('check-pi-prerequisites'),
  isElectron: true,
});
