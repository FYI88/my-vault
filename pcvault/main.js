'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell, protocol, net } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');

// Serve the renderer over a privileged 'app://' scheme so window.crypto.subtle
// (WebCrypto) is available — file:// is NOT a secure context in Electron.
const SCHEME = 'app';
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Full CSP. frame-ancestors only works as a response header (ignored in a meta
// tag), so the app:// handler below delivers this header; the index.html meta
// carries the rest for the dev-server/browser harness.
const CSP_HEADER = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'";

function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.html') return 'text/html';
  if (ext === '.css') return 'text/css';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript';
  if (ext === '.png') return 'image/png';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
}

let win = null;

// App icon (dev only — the packaged EXE embeds build/icon.ico via win.icon, so
// build/ is not shipped; guard keeps a missing file from breaking dev runs).
const APP_ICON = path.join(__dirname, 'build', 'icon.ico');

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 420,
    minHeight: 600,
    icon: fs.existsSync(APP_ICON) ? APP_ICON : undefined,
    backgroundColor: '#fbf6f3', // --cream — no flash of a different tone behind the page
    title: 'My Vault',
    autoHideMenuBar: true,
    // Frameless: the page draws its own thin titlebar (macOS-style traffic lights
    // + the app header in one strip — .titlebar in styles.css), so the window
    // chrome belongs to the keepsake design instead of floating OS buttons on a
    // band. Controls go through the win:* IPC below; the strip is the drag region
    // and double-click maximizes. (Tradeoff: no Win11 snap-layout flyout.)
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadURL(`${SCHEME}://bundle/index.html`);

  if (process.env.PCVAULT_DEBUG) {
    // Electron 30+ passes a structured event; keep both shapes for safety.
    win.webContents.on('console-message', (event, ...legacy) => {
      if (event && event.message !== undefined && !legacy.length) {
        console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
      } else {
        console.log(`[renderer:${legacy[0]}] ${legacy[1]} (${legacy[3]}:${legacy[2]})`);
      }
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.log(`[main] did-fail-load ${code} ${desc}`);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.log(`[main] render-process-gone ${details.reason}`);
    });
  }

  win.on('closed', () => { win = null; });

  // Push window state to the renderer so the traffic lights can react:
  // the green dot swaps to the restore glyph while maximized, and all three
  // dots desaturate while the window is unfocused (macOS-style).
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
  win.on('focus', () => win.webContents.send('win:focused', true));
  win.on('blur', () => win.webContents.send('win:focused', false));
}

app.whenReady().then(() => {
  loadVaultPath(); // restore the vault path the user picked in a previous run

  // Serve files from src/ under app://bundle/<file>
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const rel = url.pathname.replace(/^\/+/, '');
    const filePath = path.normalize(path.join(__dirname, 'src', rel));
    const srcRoot = path.join(__dirname, 'src');
    // Guard: never serve outside src/ — path-boundary check, not a string prefix,
    // so a sibling directory named e.g. 'src-evil' can never pass (SEC-003).
    if (filePath !== srcRoot && !filePath.startsWith(srcRoot + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    const mime = mimeFor(filePath);
    if (mime === 'text/html') {
      // Deliver the full CSP (incl. frame-ancestors) as a real response header
      const body = await net.fetch(pathToFileURL(filePath).toString());
      const html = await body.arrayBuffer();
      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'Content-Security-Policy': CSP_HEADER,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    return net.fetch(pathToFileURL(filePath).toString(), {
      headers: { 'content-type': mime },
    });
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// ---- window controls (frameless titlebar) ----------------------------------
ipcMain.on('win:minimize', () => { if (win) win.minimize(); });
ipcMain.on('win:toggleMaximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('win:close', () => { if (win) win.close(); });
// Initial state, requested by the renderer on boot (events above only fire on change).
ipcMain.handle('win:getState', () => ({
  maximized: !!win && win.isMaximized(),
  focused: !!win && win.isFocused(),
}));

// ---- Vault file IPC ---------------------------------------------------------
// Trusted-path model: every path the renderer can hand us must have been minted
// by one of our own dialogs (or derived from the folder it picked). The renderer
// is treated as compromised, so these checks are the only thing between it and
// the filesystem.

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let vaultPath = null;     // the one vault file main will read/write
let lastCopyDst = null;   // backup destination from the last saveCopyAs dialog
let lastExportDst = null; // export destination from the last saveFileAs dialog

// Paths may use either separator style; normalize before comparing.
function samePath(a, b) {
  return !!a && !!b && path.normalize(a) === path.normalize(b);
}

function loadVaultPath() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
    if (typeof s.vaultPath === 'string' && s.vaultPath) vaultPath = s.vaultPath;
  } catch (e) { /* first run — no settings yet */ }
}
function saveVaultPath() {
  try {
    fs.writeFileSync(SETTINGS_FILE(), JSON.stringify({ vaultPath }));
  } catch (e) { /* best-effort — never fatal */ }
}

// The remembered vault path lives only here (main's userData settings.json) —
// the renderer keeps no copy of it (SEC-004). These two handlers move no
// renderer-supplied path: they return and clear main's own remembered state.
ipcMain.handle('vault:getLastPath', () => vaultPath);
ipcMain.handle('vault:forgetPath', () => {
  vaultPath = null;
  saveVaultPath();
  return true;
});

// Pick a folder (create-time location). The vault file lives inside it.
ipcMain.handle('vault:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose where your vault file lives',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  vaultPath = path.join(r.filePaths[0], 'myvault.cvault');
  saveVaultPath();
  return r.filePaths[0];
});

// Pick an existing vault file to open.
ipcMain.handle('vault:pickVaultFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open your vault file',
    properties: ['openFile'],
    filters: [{ name: 'My Vault file', extensions: ['cvault'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  vaultPath = r.filePaths[0];
  saveVaultPath();
  return r.filePaths[0];
});

// Save-as copy (backup) target.
ipcMain.handle('vault:saveCopyAs', async (_e, suggestedName) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Back up your vault',
    defaultPath: suggestedName || 'my-vault-backup.cvault',
    filters: [{ name: 'My Vault file', extensions: ['cvault'] }],
  });
  if (r.canceled || !r.filePath) return null;
  lastCopyDst = r.filePath;
  return r.filePath;
});

// Save-as dialog for exporting a decrypted copy of an item (photos/videos/docs).
ipcMain.handle('vault:saveFileAs', async (_e, suggestedName) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export a copy',
    defaultPath: suggestedName || 'export.bin',
  });
  if (r.canceled || !r.filePath) return null;
  lastExportDst = r.filePath;
  return r.filePath;
});

// Everything below rejects any path that did not come from a dialog above. A
// compromised renderer can only reach files the user explicitly chose.

// Write an exported plaintext copy (explicit user action only).
ipcMain.handle('vault:writeFile', async (_e, filePath, bytes) => {
  if (filePath !== lastExportDst) throw new Error('forbidden path');
  await fsp.writeFile(filePath, Buffer.from(bytes));
  return true;
});

// Read a whole file as bytes.
ipcMain.handle('vault:readFile', async (_e, filePath) => {
  if (!samePath(filePath, vaultPath)) throw new Error('forbidden path');
  const buf = await fsp.readFile(filePath);
  return new Uint8Array(buf);
});

// Atomic write: temp file in the same dir + rename, so a crash mid-write never
// leaves a truncated vault file. If the rename fails (vault locked by another
// process, antivirus, disk full) the temp file is unlinked so no orphaned copy
// of the vault lingers next to it (SEC-008).
ipcMain.handle('vault:writeFileAtomic', async (_e, filePath, bytes) => {
  if (!samePath(filePath, vaultPath)) throw new Error('forbidden path');
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const buf = Buffer.from(bytes);
  await fsp.writeFile(tmp, buf);
  try {
    await fsp.rename(tmp, filePath);
  } catch (err) {
    try { await fsp.unlink(tmp); } catch (e) { /* best-effort cleanup */ }
    throw err;
  }
  return true;
});

// Copy file (backup). Returns true or throws.
ipcMain.handle('vault:copyFile', async (_e, src, dst) => {
  if (!samePath(src, vaultPath) || dst !== lastCopyDst) throw new Error('forbidden path');
  await fsp.copyFile(src, dst);
  return true;
});

ipcMain.handle('vault:reveal', (_e, filePath) => {
  if (!samePath(filePath, vaultPath)) return;
  shell.showItemInFolder(filePath);
});

// Validate that a chosen vault location is a real folder (create flow only).
ipcMain.handle('vault:isDir', async (_e, p) => {
  if (!samePath(p, vaultPath && path.dirname(vaultPath))) return false;
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
});

ipcMain.handle('vault:exists', async (_e, p) => {
  if (!samePath(p, vaultPath)) return false;
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
});
