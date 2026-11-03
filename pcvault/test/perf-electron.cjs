'use strict';

// Only launched by perf-large-vault.mjs with a freshly created temp profile.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const profile = process.env.VAULT_PERF_PROFILE;
if (!profile || !fs.existsSync(path.join(profile, 'PERF-ONLY'))) throw new Error('isolated profile required');
app.setPath('userData', profile);
const started = performance.now();
let finished = false;
let window;
let unlocked = false;
let inputStarted;
let passwordScreenMs;
let unlockMs;
let passwordScreenPeaksKiB;
let currentStage;
let stageStarted;
const stages = [];
const peaks = {};
const io = [];
const disk = { readBytes: 0, writeBytes: 0, readMs: 0, writeMs: 0, syncMs: 0 };
const openFile = fs.promises.open;
fs.promises.open = async function (file, ...args) {
  const handle = await openFile.call(this, file, ...args);
  if (!String(file).startsWith(process.env.VAULT_PERF_FILE)) return handle;
  for (const operation of ['read', 'write', 'sync']) {
    const original = handle[operation].bind(handle);
    handle[operation] = async (...values) => {
      const start = performance.now();
      try {
        const result = await original(...values);
        if (operation === 'read') disk.readBytes += result.bytesRead;
        if (operation === 'write') disk.writeBytes += result.bytesWritten;
        return result;
      } finally { disk[operation + 'Ms'] += performance.now() - start; }
    };
  }
  return handle;
};
const readFile = fs.promises.readFile;
fs.promises.readFile = async function (file, ...args) {
  const start = performance.now();
  const bytes = await readFile.call(this, file, ...args);
  if (String(file) === process.env.VAULT_PERF_FILE) io.push({ operation: 'read', ms: Math.round(performance.now() - start), bytes: bytes.length });
  return bytes;
};
function finish(reason, extra = {}) {
  if (finished) return;
  finished = true;
  console.log('VAULT_PERF_RESULT ' + JSON.stringify({ reason, elapsedMs: Math.round(performance.now() - started),
    sizeMiB: Number(process.env.VAULT_PERF_MIB), peaksKiB: peaks, io, stages,
    passwordScreenMs, passwordScreenPeaksKiB, unlockMs, currentStage,
    disk: Object.fromEntries(Object.entries(disk).map(([k, v]) => [k, Math.round(v)])), ...extra }));
  app.exit(reason === 'complete' || reason === 'tamper-rejected' ? 0 : 1);
}
app.on('browser-window-created', (_event, win) => {
  window = win;
  // This is a foreground-interaction benchmark. Keep its synthetic window's
  // observer/timer delivery active even if another app briefly covers it.
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3 || event.message?.startsWith('VAULT_PERF')) console.log('VAULT_PERF_CONSOLE ' + event.message);
  });
  win.webContents.on('render-process-gone', (_e, details) => finish('renderer-' + details.reason));
  win.webContents.on('did-finish-load', async () => {
    try {
      await win.webContents.executeJavaScript(`
        window.__perf = { maxTickGapMs: 0, maxVisibleTickGapMs: 0, longTasks: 0, longestTaskMs: 0 };
        let last = performance.now();
        let wasVisible = !document.hidden;
        setInterval(() => {
          const now = performance.now();
          window.__perf.maxTickGapMs = Math.max(window.__perf.maxTickGapMs, now-last);
          if (wasVisible && !document.hidden) window.__perf.maxVisibleTickGapMs = Math.max(window.__perf.maxVisibleTickGapMs, now-last);
          wasVisible = !document.hidden;
          last = now;
        }, 50);
        new PerformanceObserver(list => { for (const e of list.getEntries()) { window.__perf.longTasks++; window.__perf.longestTaskMs=Math.max(window.__perf.longestTaskMs,e.duration); } }).observe({ type: 'longtask', buffered: true });
      `);
    } catch { /* load may terminate; timeout reports it */ }
  });
});
let checking = false;
const interval = setInterval(async () => {
  for (const metric of app.getAppMetrics()) {
    const key = metric.type;
    peaks[key] = Math.max(peaks[key] || 0, metric.memory.workingSetSize);
  }
  if ((peaks.Tab || 0) > 2.5 * 1024 ** 2) { finish('renderer-memory-limit'); return; }
  if (checking || !window || finished || window.webContents.isDestroyed()) return;
  checking = true;
  try {
    const status = await window.webContents.executeJavaScript(`(async () => ({
      ready: !!(await import('./renderer.js')).state.manifest,
      locked: document.getElementById('screen-locked')?.classList.contains('active'),
      opened: document.getElementById('screen-unlocked')?.classList.contains('active'),
      stage: document.getElementById('unlockStatus')?.textContent,
      perf: window.__perf,
      error: document.getElementById('unlockErr')?.textContent,
      tampered: !document.getElementById('tamperWarn')?.classList.contains('hidden')
    }))()`);
    if (status.stage !== currentStage) {
      if (currentStage) stages.push({ stage: currentStage, ms: Math.round(performance.now() - stageStarted) });
      currentStage = status.stage;
      stageStarted = performance.now();
    }
    if (status.locked && status.ready && !inputStarted) {
      inputStarted = performance.now();
      passwordScreenMs = Math.round(inputStarted - started);
      passwordScreenPeaksKiB = { ...peaks };
      console.log('VAULT_PERF_LOCKED ' + JSON.stringify({ ms: passwordScreenMs }));
      await window.webContents.executeJavaScript(`
        document.getElementById('unlockPass').value = 'Synthetic-test-only-482!';
        document.getElementById('unlockForm').requestSubmit();
      `);
    }
    if (status.tampered) {
      finish(process.env.VAULT_PERF_EXPECT_TAMPER ? 'tamper-rejected' : 'unexpected-integrity-failure', { perf: status.perf });
      return;
    }
    if (status.opened && process.env.VAULT_PERF_EXPECT_TAMPER) { finish('tamper-missed'); return; }
    if (status.opened && !unlocked) {
      unlocked = true;
      unlockMs = Math.round(performance.now() - inputStarted);
      if (process.env.VAULT_PERF_VIDEOS) {
        // Do not report success before automatic thumbnail hydration has run.
        await new Promise((resolve) => setTimeout(resolve, 10000));
        const media = await window.webContents.executeJavaScript(`(async () => {
          const ui = await import('./renderer.js');
          return { thumbnails: ui.state.thumbCache.size, cells: document.querySelectorAll('.vault-photo-cell').length,
            done: [...document.querySelectorAll('.vault-photo-cell')].map(c => c.dataset.done || ''),
            placeholders: document.querySelectorAll('.vault-photo-cell[data-kind="video"] .play-badge').length,
            autoVideoCount: ui.state.items.filter(r => r.kind === 'video' && (r.photoLen || 0) <= 32 * 1024 ** 2).length,
            hidden: document.hidden,
            retainedCiphertexts: ui.state.items.filter(r => !!r.photo).length, perf: window.__perf };
        })()`);
        if (media.autoVideoCount ? !media.thumbnails : media.placeholders !== media.cells) { finish('thumbnail-failed', { media }); return; }
        finish('complete', { media, perf: media.perf });
        return;
      }
      let smoke;
      if (process.env.VAULT_PERF_SMOKE) {
        smoke = await window.webContents.executeJavaScript(`(async () => {
          const ui = await import('./renderer.js');
          const results = [];
          const assert = (condition, name) => { if (!condition) throw new Error('smoke: ' + name); results.push(name); };
          const until = async (predicate, name) => {
            const start = performance.now();
            while (!predicate()) {
              if (performance.now() - start > 15000) throw new Error('smoke timeout: ' + name);
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          };
          const close = async () => {
            document.getElementById('itemBackBtn').click();
            await until(() => document.getElementById('itemOverlay').classList.contains('hidden'), 'viewer close');
          };
          await ui.openItem('media-photo');
          assert(document.getElementById('itemImg').naturalWidth === 160, 'lazy photo decoded');
          await close();
          await ui.openItem('media-video');
          const video = document.getElementById('itemVideo');
          await until(() => video.readyState >= 1, 'video metadata');
          assert(video.videoWidth === 160, 'lazy video decoded');
          await close();
          await ui.openItem(ui.state.items.find(r => r.kind === 'doc').id);
          assert(!document.getElementById('itemDocInfo').classList.contains('hidden'), 'lazy document preview');
          await close();
          const count = ui.state.items.length;
          await ui.handleFiles([new File(['synthetic text'], 'smoke.txt', { type: 'text/plain' })]);
          const imported = ui.state.items.find(r => !r.photo && ui.state.nameCache.get(r.id) === 'smoke.txt');
          assert(ui.state.items.length === count + 1 && !!imported, 'import saved without retained ciphertext');
          await ui.openItem(imported.id);
          assert(document.getElementById('itemTextContent').textContent === 'synthetic text', 'import reads back from disk');
          await close();
          document.getElementById('journalTabBtn').click();
          document.getElementById('journalEntry').value = 'synthetic journal';
          const journalsBefore = ui.state.items.filter(r => r.kind === 'journal').map(r => r.id);
          document.getElementById('journalSaveBtn').click();
          await until(() => ui.state.items.some(r => r.kind === 'journal' && !journalsBefore.includes(r.id) && !r.photo), 'journal saved');
          document.getElementById('secretsTabBtn').click();
          document.getElementById('secretsLabel').value = 'synthetic label';
          document.getElementById('secretsSecret').value = 'synthetic secret';
          document.getElementById('secretsSaveBtn').click();
          await until(() => ui.state.items.some(r => r.kind === 'secret' && !r.photo), 'secret saved');
          const expected = ui.state.items.length;
          ui.lock();
          assert(ui.state.secretsCache.size === 0 && ui.state.journalCache.size === 0 && ui.state.urls.size === 0, 'lock wipes caches');
          // Reopen the actual file through the bridge and trigger the real UI
          // open handler using its already-authorized synthetic destination.
          const index = await window.vaultAPI.openIndexed(ui.state.path);
          assert(index.items.length === expected && index.items.every(r => !r.photo), 'reopen retains all records as metadata');
          // Do not mutate the contextBridge API; use the indexed records as a
          // fresh launch would, then drive the normal password form again.
          ui.state.items = index.items; ui.state.manifest = index.manifest; ui.state.storeToken = index.token;
          document.getElementById('unlockPass').value = 'Synthetic-test-only-482!';
          document.getElementById('unlockForm').requestSubmit();
          await until(() => ui.state.unlocked && document.getElementById('screen-unlocked').classList.contains('active'), 'reunlock');
          await ui.openItem(imported.id);
          assert(document.getElementById('itemTextContent').textContent === 'synthetic text', 'text persists after reopen');
          await close();
          document.getElementById('journalTabBtn').click();
          await until(() => document.getElementById('journalEntry').value === 'synthetic journal', 'journal reload');
          results.push('journal persists after reopen');
          document.getElementById('secretsTabBtn').click();
          await until(() => [...ui.state.secretsCache.values()].some(v => v.secret === 'synthetic secret'), 'secret reload');
          results.push('secret persists after reopen');
          return results;
        })()`, true);
      }
      finish('complete', { perf: status.perf, ...(smoke ? { smoke } : {}) });
    } else if (status.error) finish('unlock-error', { stage: status.stage, error: status.error, perf: status.perf });
  } catch (error) {
    if (unlocked) finish('smoke-failed', { error: error.message });
    else if (!finished) console.log('VAULT_PERF_PROBE ' + error.name);
  } finally { checking = false; }
}, 100);
setTimeout(() => { clearInterval(interval); finish('timeout'); }, 90000);
require('../main.js');
