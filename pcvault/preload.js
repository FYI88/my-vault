'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultAPI', {
  pickFolder: () => ipcRenderer.invoke('vault:pickFolder'),
  pickVaultFile: () => ipcRenderer.invoke('vault:pickVaultFile'),
  pickFiles: () => ipcRenderer.invoke('vault:pickFiles'),
  saveCopyAs: (suggestedName) => ipcRenderer.invoke('vault:saveCopyAs', suggestedName),
  saveFileAs: (suggestedName) => ipcRenderer.invoke('vault:saveFileAs', suggestedName),
  writeFile: (p, bytes) => ipcRenderer.invoke('vault:writeFile', p, bytes),
  readFile: (p) => ipcRenderer.invoke('vault:readFile', p),
  writeFileAtomic: (p, bytes) => ipcRenderer.invoke('vault:writeFileAtomic', p, bytes),
  copyFile: (src, dst) => ipcRenderer.invoke('vault:copyFile', src, dst),
  reveal: (p) => ipcRenderer.invoke('vault:reveal', p),
  isDir: (p) => ipcRenderer.invoke('vault:isDir', p),
  exists: (p) => ipcRenderer.invoke('vault:exists', p),
  getLastPath: () => ipcRenderer.invoke('vault:getLastPath'),
  forgetPath: () => ipcRenderer.invoke('vault:forgetPath'),

  // Custom lock-screen background (image/video).
  pickBackground: () => ipcRenderer.invoke('vault:pickBackground'),
  clearBackground: () => ipcRenderer.invoke('vault:clearBackground'),
  getBackground: () => ipcRenderer.invoke('vault:getBackground'),

  // Delete originals after verified import (Settings → Originals).
  confirmDeleteOriginals: (files) => ipcRenderer.invoke('vault:confirmDeleteOriginals', files),
  deleteOriginals: (paths) => ipcRenderer.invoke('vault:deleteOriginals', paths),

  // Frameless window controls (the page draws its own traffic lights).
  windowControls: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    getState: () => ipcRenderer.invoke('win:getState'),
    onMaximized: (cb) => ipcRenderer.on('win:maximized', (_e, v) => cb(v)),
    onFocus: (cb) => ipcRenderer.on('win:focused', (_e, v) => cb(v)),
  },
});
