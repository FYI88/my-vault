// tauri-bridge.js — exposes the same `window.vaultAPI` contract the renderer
// expects, backed by Tauri's invoke() instead of Electron's preload.
//
// Loaded only by the Tauri build (before renderer.js). In Electron the preload
// script already defines window.vaultAPI; in a plain browser neither exists and
// the renderer shows its friendly "open the app" toast.
//
// Binary data crosses the IPC as base64 strings (Tauri's JSON IPC serializes
// JSON arrays horribly for large Uint8Arrays).
(function () {
  'use strict';
  if (window.vaultAPI || !window.__TAURI__ || !window.__TAURI__.core) return;
  const { invoke } = window.__TAURI__.core;

  // Uint8Array <-> base64 (browser-safe, no atob/btoa stack limits for big files)
  function bytesToB64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  window.vaultAPI = {
    pickFolder: () => invoke('pick_folder'),
    pickVaultFile: () => invoke('pick_vault_file'),
    saveCopyAs: (suggestedName) => invoke('save_copy_as', { suggestedName }),
    saveFileAs: (suggestedName) => invoke('save_file_as', { suggestedName }),
    writeFile: (p, bytes) => invoke('write_file', { filePath: p, bytesB64: bytesToB64(bytes) }),
    readFile: async (p) => b64ToBytes(await invoke('read_file', { filePath: p })),
    writeFileAtomic: (p, bytes) => invoke('write_file_atomic', { filePath: p, bytesB64: bytesToB64(bytes) }),
    copyFile: (src, dst) => invoke('copy_file', { src, dst }),
    reveal: (p) => invoke('reveal', { filePath: p }),
    isDir: (p) => invoke('is_dir', { p }),
    exists: (p) => invoke('exists', { p }),
    getLastPath: () => invoke('get_last_path'),
    forgetPath: () => invoke('forget_path'),
    // Custom lock-screen background (image/video) — same contract as Electron.
    pickBackground: () => invoke('pick_background'),
    clearBackground: () => invoke('clear_background'),
    getBackground: async () => {
      const r = await invoke('get_background');
      if (!r) return null;
      // bytes cross IPC as base64; decode back to a Uint8Array for the Blob
      return { kind: r.kind, name: r.name, bytes: b64ToBytes(r.bytes) };
    },
  };
})();
