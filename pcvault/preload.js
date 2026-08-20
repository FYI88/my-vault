'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vaultAPI', {
  pickFolder: () => ipcRenderer.invoke('vault:pickFolder'),
  pickVaultFile: () => ipcRenderer.invoke('vault:pickVaultFile'),
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
});
