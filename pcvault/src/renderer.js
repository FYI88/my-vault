// renderer.js — the vault UI. All crypto runs here (WebCrypto over the secure
// app:// scheme); the main process only moves bytes to/from disk. Zero network.
import {
  createVault, unlockWithPass, unlockWithSeed,
  changePass, rotateSeed,
  wrapItemKey, unwrapItemKey, encText, decText, encBytes, decBytes,
  tamperSample, vaultImportAESKey, vaultPassScore, bip39Generate,
  vaultWipeRaw, vaultRandId,
} from './vault-crypto.mjs';
import { serializeVault, parseVault } from './container.mjs';
import { initWormhole } from './wormhole.mjs';
import { initParticles } from './particles.mjs';
import { createPhantomGallery } from './phantom-gallery.mjs';
import { createGarden } from './garden.mjs';
import { emptyYear, parseYearJSON, serializeYear, todayKey, yearKey, calcStreak, sortedDayKeys, yearOf } from './journal.mjs';

const $ = (id) => document.getElementById(id);
const LS_IDLE = 'pcvault.idleMin';
const LS_BG = 'pcvault.bg'; // 'wormhole' (default) or 'particles'
const IDLE_OPTIONS = [0, 1, 5, 15];

// lucide-style inline icons (the phone app's `ic()` helper, reduced to what this UI uses)
const ICON_PATHS = {
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
};
function ic(name, cls) {
  const inner = ICON_PATHS[name] || '';
  return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
}

const state = {
  path: null,        // the vault file on disk
  manifest: null,    // wrapped keys + cursor (ciphertext/wrapped only)
  dek: null,         // non-extractable CryptoKey — dropped on lock
  items: [],         // records; photo bytes are ciphertext, safe to hold
  unlocked: false,
  urls: new Set(),     // object URLs to revoke on lock
  thumbCache: new Map(), // id → thumbnail object URL — re-render after a reorder stays instant
  nameCache: new Map(),  // id → decrypted file name (search index) — plaintext, wiped on lock
  namesReady: null,      // one in-flight decryption of every name, shared across calls
  searchQuery: '',       // lowercased live query
  pendingDek: null,   // held between "create" and "I've saved them"
  rotatePhrase: null,// rotation in progress — old words die only on save
  idleTimer: null,
  galleryMode: false, // phantom infinite gallery view
  phantomGallery: null,
  journalTab: false,    // Journal tab active (vs Vault)
  journalCache: new Map(), // year → decrypted journal blob — plaintext, wiped on lock
  journalYear: null,    // the year the journal screen is showing
  garden: null,         // canvas garden renderer
};
let currentItemId = null;
let currentItemKind = null; // 'photo' | 'video' | 'doc' — which view the overlay shows
let toastTimer = null;

// ---- immersive viewer (full-bleed stage + floating chrome) ----
let viewerZoom = 1;          // photo zoom factor (1 = fit)
let viewerPanX = 0;
let viewerPanY = 0;
let viewerZoomDrag = null;   // active pan gesture
let chromeTimer = null;
let chromeHidden = false;
const CHROME_IDLE_MS = 2500; // stillness before the HUD fades out

function viewerOpen() { return !$('itemOverlay').classList.contains('hidden'); }

function setChromeHidden(hidden) {
  chromeHidden = hidden;
  $('viewerTop').classList.toggle('chrome-hidden', hidden);
  $('viewerBottom').classList.toggle('chrome-hidden', hidden);
}
function pokeChrome(e) {
  if (!viewerOpen()) return;
  // keep the chrome visible while the cursor rests on a HUD control
  if (e && e.target && e.target.closest && e.target.closest('.viewer-hud')) return;
  setChromeHidden(false);
  clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => { if (viewerOpen()) setChromeHidden(true); }, CHROME_IDLE_MS);
}

function resetViewerZoom() {
  viewerZoom = 1;
  viewerPanX = 0;
  viewerPanY = 0;
  viewerZoomDrag = null;
  const img = $('itemImg');
  img.classList.remove('zoomed', 'dragging');
  img.style.transform = '';
  img.style.transformOrigin = '';
}
function setViewerZoom(zoom, oxPct, oyPct) {
  viewerZoom = Math.min(5, Math.max(1, zoom));
  const img = $('itemImg');
  img.style.transformOrigin = `${oxPct}% ${oyPct}%`;
  img.classList.toggle('zoomed', viewerZoom > 1);
  if (viewerZoom <= 1) viewerPanX = viewerPanY = 0;
  img.style.transform = `translate(${viewerPanX}px, ${viewerPanY}px) scale(${viewerZoom})`;
}

function viewerNav(delta) {
  if (!state.unlocked || !currentItemId || !state.items.length) return;
  const idx = state.items.findIndex((r) => r.id === currentItemId);
  if (idx === -1) return;
  const next = state.items[(idx + delta + state.items.length) % state.items.length];
  openItem(next.id);
}

function toggleFullscreen() {
  const el = $('itemOverlay');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen();
}

// ---- auth-screen particle background (welcome/create/locked/seed) ----
let bgCtrl = null; // background controller — wormhole or particles, per settings
const AUTH_SCREENS = new Set(['welcome', 'create', 'locked', 'seed', 'settings']);

// ---- in-app PDF viewer (offline pdf.js, canvas-rendered) ----
let pdfDoc = null;        // pdf.js document proxy (numPages / getPage)
let pdfTask = null;       // pdf.js loading task (owns destroy())
let pdfPage = 1;          // current page (1-based)
let pdfPageCount = 0;
let pdfScale = 1;         // current zoom factor
let pdfRenderTask = null; // in-flight page render, cancelled when paging/leaving
let pdfRenderSeq = 0;     // stale-render guard (rapid paging)
let pdfjsReady = null;    // lazy import of pdf.js + its worker module

// ---- screens ----


function show(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
  if (bgCtrl) bgCtrl.setActive(AUTH_SCREENS.has(name));
}
function showOverlay(id, visible) {
  $(id).classList.toggle('hidden', !visible);
}
function closeItemOverlay() {
  showOverlay('itemOverlay', false);
  currentItemId = null;
  currentItemKind = null;
  closePdf();
  const video = $('itemVideo');
  video.pause(); video.removeAttribute('src'); video.load();
  setHidden('itemVideo', true);
  setHidden('itemImg', true);
  setHidden('itemDocInfo', true);
  setHidden('itemText', true);
  setHidden('viewerPlay', true);
  $('itemTextContent').textContent = '';
  resetViewerZoom();
  clearTimeout(chromeTimer);
  setChromeHidden(false);
  if (document.fullscreenElement) document.exitFullscreen();
}

// ---- tiny helpers ----
function setErr(id, msg) { const el = $(id); if (el) el.textContent = msg || ''; }
function setOk(id, msg) { const el = $(id); if (el) el.textContent = msg || ''; }
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
function setHidden(id, hidden) { $(id).classList.toggle('hidden', hidden); }
function refreshPathLines() {
  $('lockedPathLine').textContent = state.path || '';
  $('vaultPathLine').textContent = state.path || '';
  $('settingsPathLine').textContent = state.path || '';
}

function activeScreenName() {
  const active = document.querySelector('.screen.active');
  return active ? active.id.replace('screen-', '') : '';
}

function isTextEditingTarget(target) {
  const tag = ((target && target.tagName) || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || (target && target.isContentEditable);
}

// ---- vault file ----
async function saveVault() {
  if (!state.path || !state.manifest) return;
  const bytes = serializeVault(state.manifest, state.items);
  await window.vaultAPI.writeFileAtomic(state.path, bytes);
}

async function tryLoad(path, silent) {
  try {
    const bytes = await window.vaultAPI.readFile(path);
    const parsed = parseVault(bytes);
    if (!parsed) {
      if (!silent) toast('that file does not look like a vault');
      return false;
    }
    state.path = path;
    state.manifest = parsed.manifest;
    state.items = parsed.items;
    refreshPathLines();
    setHidden('tamperWarn', true);
    $('unlockPass').value = '';
    show('locked');
    resetIdle();
    return true;
  } catch (err) {
    if (silent) {
      await window.vaultAPI.forgetPath(); // stale bookmark — the file moved or died
    } else {
      toast("couldn't open that file");
    }
    return false;
  }
}

// ---- create ----
async function handleCreate(e) {
  e.preventDefault();
  if (!window.vaultAPI) return; // browser preview without the desktop bridge
  setErr('createErr', '');
  const pass = $('createPass').value;
  const pass2 = $('createPass2').value;
  if (vaultPassScore(pass) < 3) {
    setErr('createErr', 'that passphrase is too easy to guess. make it longer and mix in numbers or symbols.');
    return;
  }
  if (pass !== pass2) {
    setErr('createErr', "the two passphrases don't match");
    return;
  }
  const folder = await window.vaultAPI.pickFolder();
  if (!folder) return;
  const path = folder.replace(/[\\/]+$/, '') + '/myvault.cvault';
  if (await window.vaultAPI.exists(path)) {
    setErr('createErr', 'a vault already exists there. open it instead.');
    return;
  }
  $('createBtn').disabled = true;
  try {
    const phrase = await bip39Generate();
    const { manifest, dekRaw } = await createVault(pass, phrase);
    const dek = await vaultImportAESKey(dekRaw);
    vaultWipeRaw(dekRaw); // raw DEK dies here — only the sealed key remains
    state.manifest = manifest;
    state.path = path;
    state.items = [];
    state.pendingDek = dek;
    await saveVault(); // the empty encrypted vault file exists on disk
    refreshPathLines();
    showSeed(phrase, false);
  } catch (err) {
    setErr('createErr', "couldn't create the vault. " + err.message);
  } finally {
    $('createBtn').disabled = false;
  }
}

// ---- seed screen (creation + rotation) ----
function showSeed(phrase, rotating) {
  const grid = $('seedGrid');
  grid.innerHTML = phrase.split(' ').map((w, i) =>
    `<div class="vault-seed-chip"><span class="vault-seed-n">${i + 1}</span>${w}</div>`).join('');
  $('seedDoneBtn').textContent = "I've saved them";
  if (rotating) {
    $('seedTitle').textContent = 'your new recovery words';
    setHidden('seedCopy', true);
    setHidden('seedWarn', false);
  } else {
    $('seedTitle').textContent = 'your recovery words';
    setHidden('seedCopy', false);
    setHidden('seedWarn', true);
  }
  show('seed');
}

async function handleSeedDone() {
  if (state.rotatePhrase) {
    state.rotatePhrase = null;
    await saveVault(); // the old words stop working from this save onward
    toast('new recovery words saved. the old ones no longer work.');
    setOk('changeOk', '');
    show('settings');
    return;
  }
  if (state.pendingDek) {
    state.dek = state.pendingDek;
    state.pendingDek = null;
  }
  state.unlocked = true;
  renderGrid();
  show('unlocked');
  resetIdle();
}

// ---- unlock ----
async function enterWithDek(dek) {
  // First unlock: fold the machine-local gallery pick into the vault file so it
  // travels with the .cvault from now on.
  if (adoptGalleryStyleIntoFile()) await saveVault();
  const r = await tamperSample(state.manifest, dek, state.items);
  if (r.tampered) {
    setHidden('tamperWarn', false);
    $('unlockPass').value = '';
    show('locked');
    return;
  }
  state.manifest.tamperIdx = r.tamperIdx;
  state.dek = dek;
  state.unlocked = true;
  setHidden('tamperWarn', true);
  $('unlockPass').value = '';
  await saveVault(); // persist the tamper cursor
  renderGrid();
  show('unlocked');
  resetIdle();
}

async function handleUnlock(e) {
  e.preventDefault();
  setErr('unlockErr', '');
  const pass = $('unlockPass').value;
  const raw = await unlockWithPass(state.manifest, pass);
  if (!raw) {
    setErr('unlockErr', 'wrong passphrase');
    return;
  }
  const dek = await vaultImportAESKey(raw);
  vaultWipeRaw(raw);
  await enterWithDek(dek);
}

async function handleSeedRecovery(e) {
  e.preventDefault();
  setErr('seedRecoveryErr', '');
  const phrase = $('seedRecoveryInput').value.trim();
  const raw = await unlockWithSeed(state.manifest, phrase);
  if (!raw) {
    setErr('seedRecoveryErr', "those words don't unlock this vault");
    return;
  }
  const dek = await vaultImportAESKey(raw);
  vaultWipeRaw(raw);
  $('seedRecoveryInput').value = '';
  setHidden('seedRecoveryForm', true);
  setHidden('seedRecoveryLink', false);
  await enterWithDek(dek);
}

// ---- lock ----
function lock() {
  state.dek = null;
  state.unlocked = false;
  state.pendingDek = null;
  state.rotatePhrase = null;
  currentItemId = null;
  currentItemKind = null;
  state.urls.forEach((u) => URL.revokeObjectURL(u));
  state.urls.clear();
  state.thumbCache.clear();
  state.nameCache.clear();
  state.namesReady = null;
  clearSearch();
  state.journalCache.clear(); // wipe the decrypted journal — no plaintext survives a lock
  state.journalYear = null;
  journalEditKey = null;
  if (state.garden) { state.garden.destroy(); state.garden = null; }
  state.journalTab = false;
  if ($('journalEntry')) $('journalEntry').value = '';
  showVaultTab();
  $('grid').querySelectorAll('.vault-photo-cell').forEach((c) => c.remove());
  destroyGallery();
  state.galleryMode = false;
  if ($('galleryToggleBtn')) $('galleryToggleBtn').classList.remove('on');
  setHidden('phantomGallery', true);
  if ($('galleryExitBtn')) setHidden('galleryExitBtn', true);
  showOverlay('itemOverlay', false);
  $('itemImg').removeAttribute('src');
  setHidden('itemImg', true);
  setHidden('viewerPlay', true);
  resetViewerZoom();
  clearTimeout(chromeTimer);
  setChromeHidden(false);
  if (document.fullscreenElement) document.exitFullscreen();
  const video = $('itemVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  setHidden('itemVideo', true);
  setHidden('itemDocInfo', true);
  closePdf();
  $('itemTextContent').textContent = '';
  setHidden('itemText', true);
  $('unlockPass').value = '';
  show('locked');
  resetIdle();
}

// ---- idle auto-lock ----
function idleMin() {
  const v = parseInt(localStorage.getItem(LS_IDLE) || '5', 10);
  return IDLE_OPTIONS.includes(v) ? v : 5;
}
function resetIdle() {
  clearTimeout(state.idleTimer);
  const min = idleMin();
  if (!min) return;
  state.idleTimer = setTimeout(() => {
    if (state.unlocked) {
      lock();
      toast(`locked after ${min} min idle`);
    }
  }, min * 60000);
}

// ---- add files (photos get EXIF-stripped; videos + docs are stored as-is) ----
const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', gz: 'application/gzip', '7z': 'application/x-7z-compressed',
};
function mimeFromName(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}
function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
// Display rule: long filenames are noise in the gallery and viewer. Show the
// first word of the name, capped at 6 chars + ellipsis. The full name is
// untouched metadata — search, export, and the hover tooltip all use it.
function shortName(name) {
  if (!name) return '';
  const base = name.replace(/\.[^./\\]+$/, ''); // drop the extension
  const first = base.split(/[\s_\-–—.]+/).filter(Boolean)[0] || base;
  if (first.length <= 6) return first;
  return first.slice(0, 6) + '…';
}
function stripExif(file) {
  // re-encode through a canvas: EXIF (GPS etc.) is never written and orientation
  // is baked in. Full resolution is kept — this is a personal archive, not a thumb.
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => {
          URL.revokeObjectURL(url);
          if (b) resolve(b); else reject(new Error('encode failed'));
        }, 'image/jpeg', 0.92);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}

// Every record keeps the phone vault's field names (`photo`/`photoIv` hold the
// content bytes regardless of kind) so the container + tamper code stay untouched.
async function encryptFile(kind, mime, name, bytes) {
  const itemKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  const itemKey = await vaultImportAESKey(itemKeyRaw);
  const wrap = await wrapItemKey(state.dek, itemKeyRaw);
  vaultWipeRaw(itemKeyRaw); // raw item key dies here — sealed key + wrapped copy remain
  const nameEnc = await encText(itemKey, name);
  const enc = await encBytes(itemKey, bytes);
  return {
    id: (kind === 'photo' ? 'p' : kind === 'video' ? 'v' : kind === 'journal' ? 'j' : 'd') + vaultRandId(),
    kind, mime, size: bytes.length,
    createdAt: Date.now(),
    nameIv: nameEnc.iv, name: nameEnc.data,
    iv: wrap.iv, itemKey: wrap.key,   // key wrap — delete = cryptographic delete
    photoIv: enc.iv, photoLen: enc.data.length, photo: enc.data,
  };
}

// SEC-006: importing buffers the whole file in memory (file.arrayBuffer() → AES-GCM
// copy), so a file over ~2 GB means a multi-GB RAM spike and a real risk of an OOM
// crash mid-batch — which would also lose the files imported before it. Skip it with
// a clear message instead of a silent spike.
const MAX_IMPORT_BYTES = 2 * 1024 ** 3; // ~2 GB per file

async function handleFiles(files) {
  if (!state.unlocked || !files.length) return;
  let added = 0;
  let skipped = 0;    // could not be read
  let skippedBig = 0; // over the size guard
  for (const file of files) {
    if (file.size > MAX_IMPORT_BYTES) {
      skippedBig++;
      continue;
    }
    try {
      const mime = file.type || mimeFromName(file.name);
      if (mime.startsWith('image/')) {
        // photos are EXIF-stripped (canvas re-encode) exactly like the phone vault
        const stripped = await stripExif(file);
        const bytes = new Uint8Array(await stripped.arrayBuffer());
        state.items.push(await encryptFile('photo', 'image/jpeg', file.name, bytes));
      } else {
        // videos + docs keep their original bytes (no transcoding, no re-encode)
        const bytes = new Uint8Array(await file.arrayBuffer());
        const kind = mime.startsWith('video/') ? 'video' : 'doc';
        state.items.push(await encryptFile(kind, mime, file.name, bytes));
      }
      added++;
    } catch (err) {
      skipped++;
    }
  }
  if (added) {
    await saveVault();
    renderGrid();
  }
  const word = added === 1 ? 'file' : 'files';
  const bits = [];
  if (added) bits.push(`${added} ${word} added to the vault`);
  if (skippedBig) bits.push(`${skippedBig} over 2 GB skipped`);
  if (skipped) bits.push(`${skipped} couldn't be read`);
  if (bits.length) toast(bits.join(', '));
}

// ---- drag-and-drop reordering (native HTML5 DnD) ----
let dragId = null;

// Move `fromId` to sit before (`after` false) or after (`after` true) `toId`.
function reorderItems(fromId, toId, after) {
  const from = state.items.findIndex((r) => r.id === fromId);
  if (from === -1) return false;
  let to = state.items.findIndex((r) => r.id === toId);
  if (to === -1 || from === to) return false;
  if (after) to += 1;
  const [moved] = state.items.splice(from, 1);
  let insertAt = to;
  if (from < to) insertAt -= 1; // removal shifts the target down by one
  state.items.splice(insertAt, 0, moved);
  return true;
}

function clearDropMarks() {
  document.querySelectorAll('#grid .drop-before, #grid .drop-after').forEach((c) =>
    c.classList.remove('drop-before', 'drop-after'));
}

function hasFiles(e) {
  return e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files');
}

// ---- file imports by drag-and-drop, EVERYWHERE on the window ----
// The UI promises "drop them anywhere on this window", but before this the
// drop was only handled on #grid and #phantomGallery — dropping on the
// padding, header, sidebar or journal pane let the drop fall through to
// Electron, which NAVIGATES the window to the file (blank/white, nothing
// imported). A window-level dragover+drop pair now owns file imports: it
// accepts the drop on any unlocked screen and imports the files, and the
// per-element handlers (grid / gallery host) call into the same guarded path
// so a single drop can never import twice (the __vaultImportHandled flag).
function handleImportDrop(e) {
  if (e.__vaultImportHandled) return;
  if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
  if (!hasFiles(e)) return;
  e.__vaultImportHandled = true;
  // ALWAYS stop the navigation (even locked): a file drop must never turn the
  // window into a blank file:// page. Import only happens when unlocked.
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  if (state.unlocked) handleFiles([...e.dataTransfer.files]);
}

function wireWindowDrop() {
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) {
      e.preventDefault(); // accept the drop everywhere (blocks Electron file navigation)
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
  });
  window.addEventListener('drop', handleImportDrop);
}

function wireReorder() {
  const grid = $('grid');
  grid.addEventListener('dragstart', (e) => {
    const cell = e.target.closest('.vault-photo-cell');
    if (!cell || !state.unlocked || !state.dek) return;
    dragId = cell.dataset.id;
    cell.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  grid.addEventListener('dragover', (e) => {
    if (!dragId || !state.unlocked || hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cell = e.target.closest('.vault-photo-cell');
    clearDropMarks();
    if (cell && cell.dataset.id !== dragId) {
      const rect = cell.getBoundingClientRect();
      cell.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    }
  });
  grid.addEventListener('drop', (e) => {
    if (!dragId || !state.unlocked || hasFiles(e)) return; // file imports keep their own handler
    e.preventDefault();
    const cell = e.target.closest('.vault-photo-cell');
    const from = state.items.findIndex((r) => r.id === dragId);
    let changed = false;
    if (from !== -1) {
      if (cell && cell.dataset.id !== dragId) {
        const rect = cell.getBoundingClientRect();
        changed = reorderItems(dragId, cell.dataset.id, e.clientY >= rect.top + rect.height / 2);
      } else if (!cell) {
        // dropped on empty space → move to the end
        state.items.push(state.items.splice(from, 1)[0]);
        changed = true;
      }
      if (changed) {
        renderGrid(); // thumbnails come from the cache — no re-decrypt
        saveVault().catch(() => toast("couldn't save the new order"));
      }
    }
    clearDropMarks();
    dragId = null;
  });
  grid.addEventListener('dragend', () => {
    document.querySelectorAll('#grid .dragging').forEach((c) => c.classList.remove('dragging'));
    clearDropMarks();
    dragId = null;
  });
}

// ---- search: names are encrypted, so the index is decrypted lazily in memory ----
// Decrypt every file name once (cached), then filter. Nothing is ever written to
// disk; the cache and query are wiped on lock like every other plaintext trace.
function ensureNames() {
  if (!state.namesReady) {
    state.namesReady = (async () => {
      for (const rec of state.items) {
        if (!state.unlocked) return; // locked mid-decrypt — drop the plaintext index
        try {
          const itemKey = await unwrapItemKey(state.dek, rec);
          const name = await decText(itemKey, { iv: rec.nameIv, data: rec.name });
          if (!state.unlocked) return; // never cache a name after lock wipes the index
          state.nameCache.set(rec.id, name);
        } catch (e) {
          state.nameCache.set(rec.id, ''); // tampered/damaged — won't match anything
        }
      }
    })();
  }
  return state.namesReady;
}

// Journal records are not files — the grid, search, and gallery all skip them.
function vaultItems() {
  return state.items.filter((r) => r.kind !== 'journal');
}

async function filteredItems() {
  const items = vaultItems();
  if (!state.searchQuery) return items;
  await ensureNames();
  return items.filter((r) => (state.nameCache.get(r.id) || '').toLowerCase().includes(state.searchQuery));
}

function clearSearch() {
  state.searchQuery = '';
  const input = $('searchInput');
  if (input) input.value = '';
  $('searchRow').classList.remove('has-query');
  setHidden('searchCount', true);
}

// ---- full-screen gallery (style-agnostic) ----
// Three controller styles share one item contract: phantom (Framer port),
// phantom-v2 (the PhantomInfiniteGallery v4 demo port — the "Infinite Gallery
// Wall" with the pixel-locked SVG divider grid) and drift (React Bits
// port). All consume the same array of decrypted items and report clicks back
// through onItemClick; only the module that renders them differs. The plumbing
// below is style-neutral.
// The gallery style is stored INSIDE the vault file (manifest.prefs.galleryStyle)
// so it travels with the vault — open the same .cvault on another PC and it
// comes back. localStorage is only a pre-unlock fallback / one-time migration:
// before a vault is loaded there's no manifest to read, and on first unlock the
// stored pick (if any) is folded into the file.
function galleryStyleChoice() {
  const fromFile = state.manifest && state.manifest.prefs && state.manifest.prefs.galleryStyle;
  if (fromFile === 'drift' || fromFile === 'phantom' || fromFile === 'phantom-v2') return fromFile;
  const v = localStorage.getItem(LS_GALLERY);
  return v === 'drift' ? 'drift' : v === 'phantom-v2' ? 'phantom-v2' : 'phantom';
}

// Fold the legacy machine-local pick into the vault file on first unlock so it
// becomes part of the manifest from then on. Returns true if it changed.
function adoptGalleryStyleIntoFile() {
  if (!state.manifest) return false;
  const inFile = state.manifest.prefs && state.manifest.prefs.galleryStyle;
  if (inFile === 'drift' || inFile === 'phantom' || inFile === 'phantom-v2') return false;
  if (!state.manifest.prefs) state.manifest.prefs = {};
  const legacy = localStorage.getItem(LS_GALLERY);
  state.manifest.prefs.galleryStyle = legacy === 'drift' ? 'drift' : legacy === 'phantom-v2' ? 'phantom-v2' : 'phantom';
  return true;
}

// Phantom wall grid prefs — ride in the vault file (manifest.prefs) like the
// style itself, so they travel with the vault. pgCols/pgRows size the base
// grid (x:y), pgScale multiplies tile sizes (50–250%). Rows 0 = auto.
function pgGridPrefs() {
  const p = (state.manifest && state.manifest.prefs) || {};
  const cols = parseInt(p.pgCols, 10);
  const rows = parseInt(p.pgRows, 10);
  const scale = parseFloat(p.pgScale);
  return {
    cols: Number.isFinite(cols) ? Math.max(1, Math.min(16, cols)) : 5,
    rows: Number.isFinite(rows) ? Math.max(0, Math.min(30, rows)) : 0,
    scale: Number.isFinite(scale) ? Math.max(0.5, Math.min(2.5, scale)) : 1,
  };
}

// Render the pills so the selected style reads as active; the phantom-only
// grid x:y + scale controls show only when the phantom wall is the choice.
function renderGalleryPills() {
  const choice = galleryStyleChoice();
  document.querySelectorAll('#galleryStylePills .vault-pill').forEach((p) => {
    p.classList.toggle('on', p.dataset.gallery === choice);
  });
  const cfg = document.getElementById('pgGridSettings');
  if (cfg) cfg.classList.toggle('hidden', choice !== 'phantom-v2');
  renderPgGridSettingsInputs();
}

// Sync the input controls with the current prefs.
function renderPgGridSettingsInputs() {
  const g = pgGridPrefs();
  const c = document.getElementById('pgColsInput');
  const r = document.getElementById('pgRowsInput');
  const s = document.getElementById('pgScaleInput');
  const sv = document.getElementById('pgScaleVal');
  if (c) c.value = String(g.cols);
  if (r) r.value = g.rows > 0 ? String(g.rows) : ''; // empty = auto
  if (s) s.value = String(Math.round(g.scale * 100));
  if (sv) sv.textContent = Math.round(g.scale * 100) + '%';
}

// Build the style-specific controller into the #phantomGallery host.
function makeGalleryController(kind) {
  const host = $('phantomGallery');
  if (kind === 'drift') {
    return createDriftWall(host, {
        columnsMin: 2,
        tileWidth: 220,
        tileHeight: 150,
        gap: 16,
        speed: 42,
        direction: 'up',
        variance: 0.45,
        parallax: 0.6,
        lift: 64,
        fade: 0.6,
        dim: 0.55,
        overlayColor: '#171014', // vault warm near-black — matches the item viewer stage
        onItemClick: (id) => openItem(id),
      });
  }
  if (kind === 'phantom-v2') {
    const g = pgGridPrefs(); // user-set grid x:y + scale (manifest.prefs, travels with the vault)
    return createPhantomGalleryV2(host, {
        ground: '#171014', // warm near-black — matches the item viewer stage
        cols: g.cols,
        fixedRows: g.rows,
        tileScale: g.scale,
        // no HUD: the v5 wall ships without zoom pills — the interactions are
        // hold-to-zoom, drag with inertia, cursor parallax (per user request)
        onItemClick: (item) => openItem(item.id),
      });
  }
  return createPhantomGallery(host, {
        backgroundColor: '#171014', // warm near-black — matches the item viewer stage
        textColor: '#8f8986',
        border: { width: 1, style: 'solid', color: 'rgba(251,246,243,0.9)' },
        hoverColor: 'rgba(255,85,136,0.6)',
        cellSize: 240,
        gap: 14,
        cellPadding: 12,
        arcAmount: 0.6,
        arcMaxAngleDeg: 28,
        arcAxis: 'horizontal',
        edgeFade: 0.25,
        parallaxStrength: 0.08,
        parallaxEase: 0.12,
        throwFriction: 0.92,
        throwVelocityScale: 1,
        onItemClick: (item) => openItem(item.id),
      });
}

// Destroy any active gallery controller so the host is clean for a rebuild.
function destroyGallery() {
  if (state.galleryStyle) { state.galleryStyle.destroy(); state.galleryStyle = null; }
  state.galleryKind = null;
  state.galleryItems = [];
}

// (Re)build the active controller if it doesn't match the chosen style.
function ensureGalleryController() {
  const kind = galleryStyleChoice();
  if (state.galleryStyle && state.galleryKind === kind) return state.galleryStyle;
  destroyGallery();
  state.galleryStyle = makeGalleryController(kind);
  state.galleryKind = kind;
  return state.galleryStyle;
}

// Collect the decrypted items both gallery styles render. Names/short names come
// from the name cache; thumbnails from the thumb cache (drawn into the grid).
async function buildGalleryItems() {
  await ensureNames();
  const items = vaultItems().map((rec) => ({
    id: rec.id,
    thumbUrl: state.thumbCache.get(rec.id) || '',
    name: state.nameCache.get(rec.id) || '',
    kind: rec.kind,
    meta: rec.kind === 'photo' ? String(new Date(rec.createdAt).getFullYear()) : fmtSize(rec.size),
  }));
  state.phantomGallery.setItems(items);
  // The gallery needs the photos too, but thumbnails only land in the cache when
  // the grid's IntersectionObserver reaches a cell. Hydrate anything missing so
  // toggling straight into the gallery never shows dark tiles. The gallery reads
  // the items array on every frame — mutating `thumbUrl` in place updates the
  // cells without a rebuild.
  const missing = state.items.filter((rec) => rec.kind !== 'doc' && !state.thumbCache.has(rec.id));
  let hydrated = false;
  for (const rec of missing) {
    try {
      const url = rec.kind === 'video' ? await videoThumbUrl(rec) : await thumbUrl(rec);
      if (!state.unlocked || !state.galleryMode) return; // locked or left mid-hydrate
      state.thumbCache.set(rec.id, url);
      const it = items.find((i) => i.id === rec.id);
      if (it) { it.thumbUrl = url; hydrated = true; }
    } catch (err) {
      // damaged record — the tile stays dark, same as the grid's "can't open"
    }
  }
  // Phantom gallery re-reads each item's thumbUrl every frame, so an in-place
  // mutation shows immediately without a rebuild. The drift wall bakes img.src
  // at tile-build time, so thumbnails that landed mid-hydrate would stay dark
  // until a rebuild — rebuild it once after hydration so they appear. (Skip
  // phantom: rebuilding would also reset the user's scroll/zoom.)
  if (hydrated && state.galleryKind === 'drift') {
    state.galleryStyle.setItems(items);
  }
}

function toggleGallery() {
  state.galleryMode = !state.galleryMode;
  if ($('galleryToggleBtn')) $('galleryToggleBtn').classList.toggle('on', state.galleryMode);
  document.body.classList.toggle('gallery-mode', state.galleryMode);
  setHidden('grid', state.galleryMode);
  setHidden('phantomGallery', !state.galleryMode);
  setHidden('gridEmpty', state.galleryMode || vaultItems().length > 0);
  setHidden('noMatches', true);
  if ($('galleryExitBtn')) setHidden('galleryExitBtn', !state.galleryMode);
  if (state.galleryMode) {
    if (!state.phantomGallery) {
      state.phantomGallery = createPhantomGallery($('phantomGallery'), {
        backgroundColor: '#fbf6f3', // the vault cream — the page's own color
        cellSize: 240,
        gap: 20,
        parallaxStrength: 0.06,
        parallaxEase: 0.12,
        throwFriction: 0.92,
        throwVelocityScale: 1,
        onItemClick: (item) => openItem(item.id),
      });
    }
    populatePhantomGallery();
  }
}

// ---- journal (living garden) ----
// One encrypted record per year. The record's ciphertext is the year blob JSON;
// decrypt-once into state.journalCache, wiped on lock. Nothing journal-related
// ever touches disk in plaintext.
const JOURNAL_MIME = 'application/x-vault-journal';
let journalEditKey = null; // the day currently open in the editor (a date key)

function journalRecordForYear(year) {
  return state.items.find((r) => r.kind === 'journal' && r.year === year);
}

async function journalForYear(year) {
  if (state.journalCache.has(year)) return state.journalCache.get(year);
  const rec = journalRecordForYear(year);
  if (!rec) {
    const empty = emptyYear(year);
    state.journalCache.set(year, empty);
    return empty;
  }
  try {
    const itemKey = await unwrapItemKey(state.dek, rec);
    const plain = await decBytes(itemKey, rec.photoIv, rec.photo);
    try {
      const blob = parseYearJSON(new TextDecoder().decode(plain));
      if (!state.unlocked) return emptyYear(year); // locked mid-decrypt — drop it
      state.journalCache.set(year, blob);
      return blob;
    } finally {
      vaultWipeRaw(plain);
    }
  } catch (e) {
    // tampered/damaged year — surface as empty rather than crash the garden
    const empty = emptyYear(year);
    state.journalCache.set(year, empty);
    return empty;
  }
}

async function saveJournalEntry(year, key, text, mood) {
  if (!state.unlocked || !state.dek) return;
  const blob = await journalForYear(year);
  if ((!text || !text.trim()) && !mood) {
    delete blob.days[key]; // empty entry → remove the day (plant uprooted)
  } else {
    blob.days[key] = { text: (text || '').trim(), mood: mood || '', updatedAt: Date.now() };
  }
  // replace the year record wholesale — the old ciphertext and its wrapped key die
  state.items = state.items.filter((r) => !(r.kind === 'journal' && r.year === year));
  const bytes = new TextEncoder().encode(serializeYear(blob));
  const rec = await encryptFile('journal', JOURNAL_MIME, String(year), bytes);
  rec.year = year;
  state.items.push(rec);
  state.journalCache.set(year, blob);
  await saveVault();
}

function prettyDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function setMoodSelection(mood) {
  document.querySelectorAll('#journalMoodRow .journal-mood').forEach((b) => {
    b.classList.toggle('on', b.dataset.mood === mood);
  });
}

function openJournalDay(key) {
  journalEditKey = key;
  const year = yearKey(key);
  journalForYear(year).then((blob) => {
    if (!state.unlocked || journalEditKey !== key) return;
    const entry = blob.days[key] || {};
    $('journalDayLabel').textContent = prettyDay(key);
    $('journalEntry').value = entry.text || '';
    setMoodSelection(entry.mood || '');
  });
}

async function renderOnThisDay(blob, year) {
  const txt = $('journalOnThisDayText');
  const mmdd = todayKey().slice(5); // month-day of today
  const years = new Set();
  for (const rec of state.items) {
    if (rec.kind === 'journal' && rec.year && rec.year !== year) years.add(rec.year);
  }
  const past = [...years].sort((a, b) => b - a);
  for (const y of past) {
    const b = await journalForYear(y);
    const key = `${y}-${mmdd}`;
    const e = b.days[key];
    if (e && e.text) {
      txt.textContent = `a year ago (${y}): ${e.text}`;
      setHidden('journalOnThisDayText', false);
      return;
    }
  }
  setHidden('journalOnThisDayText', true);
}

async function renderJournal() {
  if (!state.unlocked) return;
  const year = state.journalYear || yearOf(new Date());
  state.journalYear = year;
  const blob = await journalForYear(year);
  if (!state.unlocked || state.journalYear !== year) return;
  $('journalYearLabel').textContent = String(year);
  const streak = calcStreak(sortedDayKeys(blob));
  $('journalStreak').textContent = streak
    ? `${streak} day${streak === 1 ? '' : 's'} in a row`
    : 'plant your first entry today';
  if (state.garden) state.garden.setYear(blob);
  // default editor day: today for the current year, else the latest entry in that
  // year (or Jan 1) — it must stay inside the year being shown, or a save would
  // write the entry into the wrong year record.
  if (!journalEditKey || yearKey(journalEditKey) !== year) {
    if (year === yearOf(new Date())) {
      journalEditKey = todayKey();
    } else {
      const keys = sortedDayKeys(blob);
      journalEditKey = keys.length ? keys[keys.length - 1] : `${year}-01-01`;
    }
  }
  openJournalDay(journalEditKey);
  renderOnThisDay(blob, year);
  applyJournalSearch();
}

function applyJournalSearch() {
  const q = $('journalSearchInput') ? $('journalSearchInput').value : '';
  if (state.garden) state.garden.setQuery(q);
}

function showJournalTab() {
  state.journalTab = true;
  $('vaultTabBtn').classList.remove('on');
  $('journalTabBtn').classList.add('on');
  setHidden('vaultPane', true);
  setHidden('journalPane', false);
  // file controls are vault-only; journal has its own toolbar
  setHidden('addFilesBtn', true);
  setHidden('galleryToggleBtn', true);
  if (!state.garden) {
    state.garden = createGarden($('gardenCanvas'), {
      todayKey: todayKey(),
      onDayClick: (key) => openJournalDay(key),
    });
  }
  renderJournal();
}

function showVaultTab() {
  state.journalTab = false;
  $('vaultTabBtn').classList.add('on');
  $('journalTabBtn').classList.remove('on');
  setHidden('vaultPane', false);
  setHidden('journalPane', true);
  setHidden('addFilesBtn', false);
  setHidden('galleryToggleBtn', false);
}

// ---- grid + lazy thumbs ----
let gridIO = null;
function ensureIO() {
  if (!gridIO) {
    gridIO = new IntersectionObserver((entries) => {
      for (const ent of entries) {
        if (ent.isIntersecting) {
          const cell = ent.target;
          hydrateCell(cell, state.items.find((r) => r.id === cell.dataset.id));
          gridIO.unobserve(cell);
        }
      }
    }, { rootMargin: '150px' });
  }
}

let renderSeq = 0; // stale-render guard — a slow name decrypt must not overwrite a newer filter
async function renderGrid() {
  const seq = ++renderSeq;
  const shown = await filteredItems();
  await ensureNames(); // captions need the decrypted file name under every cell
  if (seq !== renderSeq || !state.unlocked) return; // stale render, or locked mid-decrypt
  $('grid').querySelectorAll('.vault-photo-cell').forEach((c) => c.remove());
  const querying = !!state.searchQuery;
  setHidden('gridEmpty', querying || shown.length > 0);
  setHidden('noMatches', !querying || shown.length > 0);
  if (querying) {
    $('searchCount').textContent = `${shown.length} of ${vaultItems().length} files`;
    setHidden('searchCount', false);
  } else {
    setHidden('searchCount', true);
  }
  for (const rec of shown) {
    const cell = document.createElement('div');
    cell.className = 'vault-photo-cell';
    cell.draggable = true; // reordering by drag
    cell.dataset.id = rec.id;
    cell.dataset.kind = rec.kind;
    const icon = rec.kind === 'photo' ? 'image' : rec.kind === 'video' ? 'film' : 'file';
    const cached = state.thumbCache.get(rec.id);
    const media = document.createElement('div');
    media.className = 'cell-media';
    if (cached) {
      // already decrypted once this session — reuse the thumbnail, no re-decrypt
      const badge = rec.kind === 'video' ? `<div class="play-badge">${ic('play')}</div>` : '';
      media.innerHTML = `<img src="${cached}" alt="">${badge}`;
    } else {
      media.innerHTML = `<div class="ph">${ic(icon)}</div>`;
      if (rec.kind !== 'doc') gridIO.observe(cell); // docs are icon cells — nothing to hydrate
    }
    const name = state.nameCache.get(rec.id) || '';
    const caption = document.createElement('div');
    caption.className = 'cell-name';
    caption.textContent = shortName(name); // long titles stay out of the grid
    if (name) caption.title = name; // full name on hover, always
    cell.appendChild(media);
    cell.appendChild(caption);
    cell.addEventListener('click', () => openItem(rec.id));
    $('grid').appendChild(cell);
  }
  // keep the gallery in sync: after a reorder, re-populate so the changed
  // order/set shows in full-screen view too.
  if (state.galleryMode && state.galleryStyle) populateGallery();
}

async function thumbUrl(rec) {
  const itemKey = await unwrapItemKey(state.dek, rec);
  const plain = await decBytes(itemKey, rec.photoIv, rec.photo);
  let blob;
  try {
    blob = new Blob([plain], { type: 'image/jpeg' }); // the Blob copies the bytes
  } finally {
    vaultWipeRaw(plain);
  }
  const bmp = await createImageBitmap(blob);
  const max = 480;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const thumb = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
  const url = URL.createObjectURL(thumb);
  state.urls.add(url);
  return url;
}

async function hydrateCell(cell, rec) {
  if (!rec || cell.dataset.done) return;
  cell.dataset.done = '1';
  try {
    let url;
    if (rec.kind === 'video') url = await videoThumbUrl(rec);
    else url = await thumbUrl(rec);
    if (!state.unlocked) return; // locked mid-decrypt — never show plaintext
    state.thumbCache.set(rec.id, url); // re-renders reuse this — no re-decrypt
    const badge = rec.kind === 'video' ? `<div class="play-badge">${ic('play')}</div>` : '';
    const media = cell.querySelector('.cell-media');
    if (media) media.innerHTML = `<img src="${url}" alt="">${badge}`;
  } catch (err) {
    const media = cell.querySelector('.cell-media');
    if (media) media.innerHTML = '<div class="ph"><span class="bad">can\'t open</span></div>';
  }
}

function frameToThumb(video) {
  const max = 480;
  const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
}

async function videoThumbUrl(rec) {
  const itemKey = await unwrapItemKey(state.dek, rec);
  const plain = await decBytes(itemKey, rec.photoIv, rec.photo);
  let blob;
  try {
    blob = new Blob([plain], { type: rec.mime || 'video/mp4' });
  } finally {
    vaultWipeRaw(plain);
  }
  const url = URL.createObjectURL(blob);
  state.urls.add(url);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('video timeout')), 15000);
    video.onloadeddata = () => {
      try { video.currentTime = Math.min(0.5, video.duration || 0.5); } catch (e) { /* seek may be async */ }
    };
    video.onseeked = () => { clearTimeout(to); resolve(); };
    video.onerror = () => { clearTimeout(to); reject(new Error('video error')); };
  });
  const thumbBlob = await frameToThumb(video);
  video.removeAttribute('src');
  video.load();
  const thumbUrl = URL.createObjectURL(thumbBlob);
  state.urls.add(thumbUrl);
  return thumbUrl;
}

// ---- in-app doc preview: PDF via offline pdf.js (canvas), text decoded safely ----
const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html',
  'application/json', 'application/xml', 'text/xml',
  'application/javascript', 'text/javascript', 'text/css',
]);
function isTextDoc(mime) { return mime && (TEXT_MIMES.has(mime) || mime.startsWith('text/')); }
const MAX_TEXT_PREVIEW = 200 * 1024; // enough to read, small enough to never freeze the UI
function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

// ---- offline pdf.js (bundled in src/vendor/pdfjs) ----
// Importing pdf.worker.min.mjs sets globalThis.pdfjsWorker, which pdf.js detects
// and uses as its main-thread "fake worker": no Web Worker, no worker-src, no
// eval, so the strict CSP stays intact with zero violations. Parsing runs on the
// main thread, which is fine for the personal documents this vault holds.
const PDF_CMAP_URL = new URL('./vendor/pdfjs/cmaps/', import.meta.url).href;
const PDF_FONT_URL = new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href;
const PDF_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

function ensurePdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = (async () => {
      const [pdfjsLib] = await Promise.all([
        import('./vendor/pdfjs/pdf.min.mjs'),
        import('./vendor/pdfjs/pdf.worker.min.mjs'), // side effect: globalThis.pdfjsWorker
      ]);
      return pdfjsLib;
    })();
  }
  return pdfjsReady;
}

function updatePdfChrome() {
  $('pdfPageLabel').textContent = pdfPageCount ? `page ${pdfPage} of ${pdfPageCount}` : '';
  $('pdfZoomLabel').textContent = Math.round(pdfScale * 100) + '%';
  $('pdfPrev').disabled = !pdfDoc || pdfPage <= 1;
  $('pdfNext').disabled = !pdfDoc || pdfPage >= pdfPageCount;
}

async function renderPdfPage() {
  if (!pdfDoc) return;
  const seq = ++pdfRenderSeq;
  if (pdfRenderTask) { try { pdfRenderTask.cancel(); } catch (e) { /* superseded */ } pdfRenderTask = null; }
  const page = await pdfDoc.getPage(pdfPage);
  if (seq !== pdfRenderSeq || !pdfDoc || !state.unlocked) { page.cleanup(); return; } // stale or locked
  const viewport = page.getViewport({ scale: pdfScale });
  const dpr = window.devicePixelRatio || 1;
  const canvas = $('pdfCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';
  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
  const task = page.render({ canvasContext: ctx, viewport, transform });
  pdfRenderTask = task;
  try {
    await task.promise;
  } catch (err) {
    if (err && err.name === 'RenderingCancelledException') return; // paged away — expected
    throw err;
  } finally {
    if (pdfRenderTask === task) pdfRenderTask = null;
  }
  if (seq === pdfRenderSeq) $('pdfScroll').scrollTop = 0;
}

async function openPdf(itemId, bytes) {
  closePdf(); // drop any previous document
  const pdfjsLib = await ensurePdfjs();
  if (!state.unlocked || currentItemId !== itemId) return; // left the item while loading
  const data = new Uint8Array(bytes); // pdf.js may detach what it's handed — give it a copy
  const task = pdfjsLib.getDocument({
    data,
    cMapUrl: PDF_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDF_FONT_URL,
  });
  const doc = await task.promise;
  if (!state.unlocked || currentItemId !== itemId) { task.destroy().catch(() => { }); return; }
  pdfTask = task;
  pdfDoc = doc;
  pdfPageCount = doc.numPages;
  pdfPage = 1;
  pdfScale = 1;
  setHidden('itemPdf', false);
  updatePdfChrome();
  await renderPdfPage();
}

function closePdf() {
  pdfRenderSeq++;
  if (pdfRenderTask) { try { pdfRenderTask.cancel(); } catch (e) { /* noop */ } pdfRenderTask = null; }
  const task = pdfTask;
  pdfTask = null;
  pdfDoc = null;
  if (task) { try { task.destroy().catch(() => { }); } catch (e) { /* noop */ } }
  pdfPage = 1;
  pdfPageCount = 0;
  pdfScale = 1;
  const canvas = $('pdfCanvas');
  canvas.width = 1;
  canvas.height = 1;
  canvas.removeAttribute('style');
  setHidden('itemPdf', true);
}

function pdfGo(delta) {
  if (!pdfDoc) return;
  const next = pdfPage + delta;
  if (next < 1 || next > pdfPageCount) return;
  pdfPage = next;
  updatePdfChrome();
  renderPdfPage();
}

function pdfZoom(delta) {
  if (!pdfDoc) return;
  const idx = PDF_ZOOM_STEPS.indexOf(pdfScale);
  const next = idx === -1 ? 1 : Math.min(PDF_ZOOM_STEPS.length - 1, Math.max(0, idx + delta));
  pdfScale = PDF_ZOOM_STEPS[next];
  updatePdfChrome();
  renderPdfPage();
}

// ---- item view ----
async function openItem(id) {
  if (!state.unlocked) return;
  const rec = state.items.find((r) => r.id === id);
  if (!rec) return;
  currentItemId = id;
  currentItemKind = rec.kind;
  const viewIdx = state.items.findIndex((r) => r.id === id);
  $('viewerCount').textContent = viewIdx === -1 ? '' : `${viewIdx + 1} of ${state.items.length}`;
  setHidden('itemErr', true);
  resetViewerZoom();
  setHidden('viewerPlay', true);
  $('itemTitle').textContent = '';
  $('itemDate').textContent = '';
  $('itemImg').removeAttribute('src');
  setHidden('itemImg', true);
  const video = $('itemVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  setHidden('itemVideo', true);
  setHidden('itemDocInfo', true);
  closePdf();
  $('itemTextContent').textContent = '';
  setHidden('itemText', true);
  showOverlay('itemOverlay', true);
  pokeChrome(); // show the chrome; it fades out after a moment of stillness
  try {
    const itemKey = await unwrapItemKey(state.dek, rec);
    const name = await decText(itemKey, { iv: rec.nameIv, data: rec.name });
    $('itemTitle').textContent = shortName(name);
    $('itemTitle').title = name; // full name on hover, always
    const metaBits = [new Date(rec.createdAt).toLocaleString()];
    if (rec.mime) metaBits.push(rec.mime);
    if (rec.kind !== 'photo' && rec.size != null) metaBits.push(fmtSize(rec.size));
    $('itemDate').textContent = metaBits.join(' · ');
    if (rec.kind === 'photo') {
      const plain = await decBytes(itemKey, rec.photoIv, rec.photo);
      let blob;
      try {
        blob = new Blob([plain], { type: 'image/jpeg' });
      } finally {
        vaultWipeRaw(plain);
      }
      const url = URL.createObjectURL(blob);
      state.urls.add(url);
      setHidden('itemImg', false);
      $('itemImg').src = url;
    } else if (rec.kind === 'video') {
      const plain = await decBytes(itemKey, rec.photoIv, rec.photo);
      let blob;
      try {
        blob = new Blob([plain], { type: rec.mime || 'video/mp4' });
      } finally {
        vaultWipeRaw(plain);
      }
      const url = URL.createObjectURL(blob);
      state.urls.add(url);
      setHidden('itemVideo', false);
      $('itemVideo').src = url;
      setHidden('viewerPlay', false); // paused → the big play button sits over the frame
    } else {
      // docs: PDF and text render in-app; everything else falls back to icon + export
      const plain = await decBytes(itemKey, rec.photoIv, rec.photo);
      try {
        if (rec.mime === 'application/pdf') {
          await openPdf(rec.id, plain);
        } else if (isTextDoc(rec.mime)) {
          const bytes = new Uint8Array(plain);
          const slice = bytes.subarray(0, MAX_TEXT_PREVIEW);
          let text = decodeText(slice);
          if (bytes.length > MAX_TEXT_PREVIEW) {
            text += `\n\n… showing the first ${fmtSize(MAX_TEXT_PREVIEW)} of ${fmtSize(bytes.length)}`;
          }
          $('itemTextContent').textContent = text; // textContent, never innerHTML — the file is untrusted
          setHidden('itemText', false);
        } else {
          $('docIcon').innerHTML = ic('file');
          $('docName').textContent = shortName(name);
          $('docName').title = name;
          $('docMeta').textContent = fmtSize(rec.size);
          setHidden('itemDocInfo', false);
        }
      } finally {
        vaultWipeRaw(plain);
      }
    }
  } catch (err) {
    // tampered/damaged record — loud, with delete still armed (the repair path)
    closePdf();
    setHidden('viewerPlay', true);
    setHidden('itemErr', false);
  }
}

// export a decrypted copy — the only path that writes plaintext to disk, and only
// at the user's explicit request (save dialog)
async function handleExport() {
  if (!state.unlocked || !currentItemId) return;
  const rec = state.items.find((r) => r.id === currentItemId);
  if (!rec) return;
  let plain;
  try {
    const itemKey = await unwrapItemKey(state.dek, rec);
    const name = await decText(itemKey, { iv: rec.nameIv, data: rec.name });
    plain = await decBytes(itemKey, rec.photoIv, rec.photo);
    const dst = await window.vaultAPI.saveFileAs(name || 'export');
    if (!dst) return;
    await window.vaultAPI.writeFile(dst, plain);
    toast('exported a copy');
  } catch (err) {
    toast("couldn't export. it may be damaged.");
  } finally {
    vaultWipeRaw(plain);
  }
}

async function handleDelete() {
  const btn = $('itemDeleteBtn');
  if (!currentItemId) return;
  if (btn.dataset.arm !== '1') {
    btn.dataset.arm = '1';
    btn.classList.add('armed');
    btn.textContent = 'click again to delete';
    setTimeout(() => {
      btn.dataset.arm = '';
      btn.classList.remove('armed');
      btn.textContent = 'delete';
    }, 4000);
    return;
  }
  btn.dataset.arm = '';
  btn.classList.remove('armed');
  btn.textContent = 'delete';
  state.items = state.items.filter((r) => r.id !== currentItemId);
  currentItemId = null;
  closePdf();
  await saveVault(); // the record — and its wrapped key — is gone (cryptographic delete)
  toast('deleted from the vault.');
  renderGrid();
  closeItemOverlay();
}

// ---- settings ----
async function handleChangePass(e) {
  e.preventDefault();
  setErr('changeErr', '');
  setOk('changeOk', '');
  const cur = $('changeCur').value;
  const n1 = $('changeNew').value;
  const n2 = $('changeNew2').value;
  const seed = $('changeSeed').value.trim();
  if (vaultPassScore(n1) < 3) {
    setErr('changeErr', 'that passphrase is too easy to guess. make it longer and mix in numbers or symbols.');
    return;
  }
  if (n1 !== n2) {
    setErr('changeErr', "the two passphrases don't match");
    return;
  }
  const r = await changePass(state.manifest, cur, n1, seed);
  if (!r.ok) {
    setErr('changeErr', r.err);
    return;
  }
  state.manifest = r.manifest;
  await saveVault();
  $('changeCur').value = $('changeNew').value = $('changeNew2').value = $('changeSeed').value = '';
  setOk('changeOk', 'passphrase changed. your recovery words still work.');
}

async function handleRotate(e) {
  e.preventDefault();
  setErr('rotateErr', '');
  const pass = $('rotatePass').value;
  const r = await rotateSeed(state.manifest, pass);
  if (!r.ok) {
    setErr('rotateErr', r.err);
    return;
  }
  state.manifest = r.manifest;
  state.rotatePhrase = r.phrase;
  $('rotatePass').value = '';
  showSeed(r.phrase, true);
}

function renderIdlePills() {
  const min = idleMin();
  document.querySelectorAll('#idlePills .vault-pill').forEach((p) => {
    p.classList.toggle('on', parseInt(p.dataset.min, 10) === min);
  });
}

function openSettingsScreen() {
  refreshPathLines();
  renderIdlePills();
  renderBgPills();
  setErr('changeErr', '');
  setOk('changeOk', '');
  setErr('rotateErr', '');
  show('settings');
}

function setSettingsCardCollapsed(card, collapsed) {
  card.classList.toggle('collapsed', collapsed);
  const toggle = card.querySelector('.vault-sec-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function wireSettingsCards() {
  const cards = [...document.querySelectorAll('#screen-settings .vault-sec-card')];
  cards.forEach((card, idx) => {
    setSettingsCardCollapsed(card, idx !== 0);
    const toggle = card.querySelector('.vault-sec-toggle');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      setSettingsCardCollapsed(card, !card.classList.contains('collapsed'));
    });
  });
}

// ---- background picker (wormhole vs particles) ----
function bgChoice() {
  return localStorage.getItem(LS_BG) === 'particles' ? 'particles' : 'wormhole';
}

function renderBgPills() {
  const choice = bgChoice();
  document.querySelectorAll('#bgPills .vault-pill').forEach((p) => {
    p.classList.toggle('on', p.dataset.bg === choice);
  });
}

// Mount the selected background controller on #authBg. Call whenever the choice
// changes or on boot. Reuses the same canvas; the previous controller is
// destroyed first (particles has no destroy — optional chaining handles it).
function mountBackground() {
  if (bgCtrl) bgCtrl.destroy?.();
  const canvas = $('authBg');
  if (!canvas) { bgCtrl = null; return; }
  bgCtrl = bgChoice() === 'particles'
    ? initParticles(canvas)
    : initWormhole(canvas);
  const active = document.querySelector('.screen.active');
  bgCtrl.setActive(!!active && AUTH_SCREENS.has(active.id.replace('screen-', '')));
}

// ---- strength meter ----
function updateMeter(input) {
  const meter = input.dataset.meter ? $(input.dataset.meter) : null;
  if (!meter) return;
  const score = vaultPassScore(input.value);
  Array.from(meter.children).forEach((seg, i) => {
    seg.className = i < score ? (score < 3 ? 'w' : 's') : '';
  });
}

// ---- frameless titlebar (macOS-style traffic lights) ----
function initWindowControls() {
  const wc = window.vaultAPI && window.vaultAPI.windowControls;
  document.querySelectorAll('.tl, .win-ctl').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!wc) return;
      const act = btn.dataset.win;
      if (act === 'close') wc.close();
      else if (act === 'minimize') wc.minimize();
      else if (act === 'maximize') wc.toggleMaximize();
    });
  });
  $('titlebar').addEventListener('dblclick', (e) => {
    if (e.target.closest('.tl')) return;
    if (wc) wc.toggleMaximize();
  });
  // real fullscreen hides the bar entirely (like macOS)
  document.addEventListener('fullscreenchange', () => {
    $('titlebar').classList.toggle('hidden', !!document.fullscreenElement);
  });
  // minimized windows don't always fire blur on Windows — gray the dots while hidden
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('win-inactive', document.hidden);
  });
  if (!wc) return; // browser preview without the desktop bridge
  const setRestoreGlyphs = (max) => {
    document.querySelectorAll('[data-win="maximize"]').forEach((b) => b.classList.toggle('is-restore', !!max));
  };
  wc.getState().then((s) => {
    if (!s) return;
    setRestoreGlyphs(s.maximized);
    document.body.classList.toggle('win-inactive', !s.focused);
  }).catch(() => {});
  wc.onMaximized((max) => setRestoreGlyphs(max));
  wc.onFocus((f) => document.body.classList.toggle('win-inactive', !f));
}

// ---- wiring ----
function wire() {
  initWindowControls();

  wireReorder();
  wireSettingsCards();
  $('welcomeCreateBtn').addEventListener('click', () => show('create'));
  $('welcomeOpenBtn').addEventListener('click', async () => {
    if (!window.vaultAPI) return; // browser preview without the desktop bridge
    const p = await window.vaultAPI.pickVaultFile();
    if (p) await tryLoad(p, false);
  });
  $('createBackBtn').addEventListener('click', () => show('welcome'));
  $('createForm').addEventListener('submit', handleCreate);
  $('seedDoneBtn').addEventListener('click', handleSeedDone);

  $('unlockForm').addEventListener('submit', handleUnlock);
  $('seedRecoveryLink').addEventListener('click', () => {
    setHidden('seedRecoveryForm', false);
    setHidden('seedRecoveryLink', true);
    setErr('seedRecoveryErr', '');
  });
  $('seedRecoveryCancel').addEventListener('click', () => {
    setHidden('seedRecoveryForm', true);
    setHidden('seedRecoveryLink', false);
    setErr('seedRecoveryErr', '');
  });
  $('seedRecoveryForm').addEventListener('submit', handleSeedRecovery);

  $('searchInput').addEventListener('input', () => {
    state.searchQuery = $('searchInput').value.trim().toLowerCase();
    $('searchRow').classList.toggle('has-query', !!state.searchQuery);
    renderGrid();
  });
  $('searchClear').addEventListener('click', () => {
    clearSearch();
    renderGrid();
  });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { clearSearch(); renderGrid(); $('searchInput').blur(); }
  });
  $('addFilesBtn').addEventListener('click', () => $('photoInput').click());
  $('galleryToggleBtn').addEventListener('click', toggleGallery);
  $('vaultTabBtn').addEventListener('click', showVaultTab);
  $('journalTabBtn').addEventListener('click', showJournalTab);
  $('journalSaveBtn').addEventListener('click', async () => {
    const key = journalEditKey || todayKey();
    const year = yearKey(key);
    const mood = document.querySelector('#journalMoodRow .journal-mood.on')?.dataset.mood || '';
    await saveJournalEntry(year, key, $('journalEntry').value, mood);
    toast('saved to your garden');
    await renderJournal();
  });
  document.querySelectorAll('#journalMoodRow .journal-mood').forEach((b) => {
    b.addEventListener('click', () => setMoodSelection(b.dataset.mood));
  });
  $('journalSearchInput').addEventListener('input', applyJournalSearch);
  $('journalSearchClear').addEventListener('click', () => {
    $('journalSearchInput').value = '';
    applyJournalSearch();
  });
  $('journalYearPrev').addEventListener('click', () => {
    state.journalYear = (state.journalYear || yearOf(new Date())) - 1;
    journalEditKey = null;
    renderJournal();
  });
  $('journalYearNext').addEventListener('click', () => {
    state.journalYear = (state.journalYear || yearOf(new Date())) + 1;
    journalEditKey = null;
    renderJournal();
  });
  $('photoInput').addEventListener('change', (e) => {
    handleFiles([...e.target.files]);
    e.target.value = '';
  });
  const grid = $('grid');
  ['dragover', 'dragenter'].forEach((ev) => grid.addEventListener(ev, (e) => { e.preventDefault(); grid.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => grid.addEventListener(ev, (e) => { e.preventDefault(); grid.classList.remove('over'); }));
  grid.addEventListener('drop', (e) => { handleImportDrop(e); });
  // same drag-to-import on the phantom gallery container
  const gal = $('phantomGallery');
  gal.addEventListener('dragover', (e) => { e.preventDefault(); });
  gal.addEventListener('drop', (e) => {
    e.preventDefault();
    handleImportDrop(e);
  });
  if ($('galleryExitBtn')) $('galleryExitBtn').addEventListener('click', () => toggleGallery());

  $('settingsBtn').addEventListener('click', openSettingsScreen);
  $('settingsBackBtn').addEventListener('click', () => show('unlocked'));
  $('itemBackBtn').addEventListener('click', closeItemOverlay);
  $('itemDeleteBtn').addEventListener('click', handleDelete);
  $('itemExportBtn').addEventListener('click', handleExport);
  $('pdfPrev').addEventListener('click', () => pdfGo(-1));
  $('pdfNext').addEventListener('click', () => pdfGo(1));
  $('pdfZoomOut').addEventListener('click', () => pdfZoom(-1));
  $('pdfZoomIn').addEventListener('click', () => pdfZoom(1));

// ---- immersive viewer wiring ----
  $('viewerPrevBtn').addEventListener('click', () => viewerNav(-1));
  $('viewerNextBtn').addEventListener('click', () => viewerNav(1));
  $('viewerFullscreenBtn').addEventListener('click', toggleFullscreen);
  const v = $('itemVideo');
  v.addEventListener('play', () => setHidden('viewerPlay', true));
  v.addEventListener('pause', () => {
    if (viewerOpen() && currentItemKind === 'video') setHidden('viewerPlay', false);
  });
  $('viewerPlay').addEventListener('click', () => {
    const vid = $('itemVideo');
    if (vid.paused) vid.play().catch(() => { }); else vid.pause();
  });
  const stage = $('viewerStage');
  stage.addEventListener('wheel', (e) => {
    if (!viewerOpen() || $('itemImg').classList.contains('hidden')) return;
    e.preventDefault();
    const img = $('itemImg');
    const r = img.getBoundingClientRect();
    const ox = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
    const oy = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
    setViewerZoom(viewerZoom * (e.deltaY < 0 ? 1.25 : 0.8), ox, oy);
  }, { passive: false });
  stage.addEventListener('click', (e) => {
    // clicking the letterbox around the media toggles the chrome
    if (e.target !== stage || !viewerOpen()) return;
    if (chromeHidden) pokeChrome(); else setChromeHidden(true);
  });
  const viewImg = $('itemImg');
  viewImg.addEventListener('pointerdown', (e) => {
    if (viewerZoom <= 1) return;
    viewerZoomDrag = { x: e.clientX, y: e.clientY, px: viewerPanX, py: viewerPanY };
    viewImg.setPointerCapture(e.pointerId);
    viewImg.classList.add('dragging');
  });
  viewImg.addEventListener('pointermove', (e) => {
    if (!viewerZoomDrag) return;
    viewerPanX = viewerZoomDrag.px + (e.clientX - viewerZoomDrag.x);
    viewerPanY = viewerZoomDrag.py + (e.clientY - viewerZoomDrag.y);
    viewImg.style.transform = `translate(${viewerPanX}px, ${viewerPanY}px) scale(${viewerZoom})`;
  });
  viewImg.addEventListener('pointerup', () => {
    viewerZoomDrag = null;
    viewImg.classList.remove('dragging');
  });
  viewImg.addEventListener('dblclick', (e) => {
    if (viewerZoom > 1) {
      resetViewerZoom();
    } else {
      const r = viewImg.getBoundingClientRect();
      const ox = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
      const oy = Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100));
      setViewerZoom(2, ox, oy);
    }
  });
  $('itemOverlay').addEventListener('pointermove', pokeChrome);
  $('itemOverlay').addEventListener('pointerleave', () => {
    if (viewerOpen()) setChromeHidden(true);
  });

  $('changeForm').addEventListener('submit', handleChangePass);
  $('rotateForm').addEventListener('submit', handleRotate);
  document.querySelectorAll('#idlePills .vault-pill').forEach((p) => {
    p.addEventListener('click', () => {
      localStorage.setItem(LS_IDLE, p.dataset.min);
      renderIdlePills();
      resetIdle();
      toast(p.dataset.min === '0' ? 'auto-lock off' : `auto-lock: ${p.dataset.min} min`);
    });
  });
  document.querySelectorAll('#bgPills .vault-pill').forEach((p) => {
    p.addEventListener('click', () => {
      localStorage.setItem(LS_BG, p.dataset.bg);
      renderBgPills();
      mountBackground();
      toast(p.dataset.bg === 'particles' ? 'background: particles' : 'background: wormhole');
    });
  });
  $('vaultPathLine').addEventListener('click', () => window.vaultAPI.reveal(state.path));
  $('revealBtn').addEventListener('click', () => window.vaultAPI.reveal(state.path));
  $('backupBtn').addEventListener('click', async () => {
    setOk('backupOk', '');
    const dst = await window.vaultAPI.saveCopyAs('my-vault-backup.cvault');
    if (!dst) return;
    try {
      await window.vaultAPI.copyFile(state.path, dst);
      setOk('backupOk', 'backup saved. ' + dst);
    } catch (err) {
      setOk('backupOk', '');
      toast("couldn't write the backup");
    }
  });

  document.querySelectorAll('.vault-input[data-meter]').forEach((inp) => {
    inp.addEventListener('input', () => updateMeter(inp));
  });

  // keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const key = (e.key || '').toLowerCase();
    const hasCmd = e.ctrlKey || e.metaKey;

    // lock hotkey is global while unlocked: it should work even while typing.
    if (state.unlocked && hasCmd && !e.altKey && !e.shiftKey && key === 'l') {
      e.preventDefault();
      lock();
      toast('locked');
      return;
    }

    // Esc should back out of transient locked-screen UI too.
    if (!state.unlocked && e.key === 'Escape') {
      if (!$('seedRecoveryForm').classList.contains('hidden')) {
        setHidden('seedRecoveryForm', true);
        setHidden('seedRecoveryLink', false);
        setErr('seedRecoveryErr', '');
      } else if (activeScreenName() === 'create') {
        show('welcome');
      }
      return;
    }

    if (!state.unlocked) return;

    if (hasCmd && !e.altKey && e.key === 'Tab' && !viewerOpen()) {
      e.preventDefault();
      if (activeScreenName() === 'settings') show('unlocked');
      if (state.journalTab) showVaultTab(); else showJournalTab();
      return;
    }

    if (isTextEditingTarget(e.target)) return;

    if (viewerOpen()) {
      if (e.key === 'Escape') {
        if (!document.fullscreenElement) closeItemOverlay();
        return;
      }
      if (e.target.tagName === 'VIDEO') return; // native controls own the arrows while focused
      if (e.key === 'ArrowLeft') { e.preventDefault(); viewerNav(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); viewerNav(1); return; }
      if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); return; }
      return;
    }

    if (e.key === 'Escape') {
      if (activeScreenName() === 'settings') { show('unlocked'); return; }
      if (state.journalTab) { showVaultTab(); return; }
      if (state.galleryMode) { toggleGallery(); return; }
      if (state.searchQuery) { clearSearch(); renderGrid(); return; }
    }

    if (hasCmd && !e.altKey && !e.shiftKey && key === 'f') {
      e.preventDefault();
      const input = state.journalTab ? $('journalSearchInput') : $('searchInput');
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }

    if (hasCmd && !e.altKey && !e.shiftKey && e.key === ',') {
      e.preventDefault();
      openSettingsScreen();
      return;
    }

    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      toast('shortcuts: Ctrl/Cmd+L lock, Ctrl/Cmd+F search, Ctrl/Cmd+, settings, Ctrl/Cmd+Tab switch tabs, G gallery, Esc back');
      return;
    }

    if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      toggleGallery();
    }
  });

  ['pointermove', 'keydown', 'click', 'wheel'].forEach((ev) =>
    window.addEventListener(ev, resetIdle, { passive: true }));

  // titlebar becomes frosted glass when scrolling the unlocked vault down
  let _scrollTicking = false;
  const SCROLL_GLASS = 8; // px threshold before the bar turns opaque
  window.addEventListener('scroll', () => {
    if (!_scrollTicking) {
      requestAnimationFrame(() => {
        document.body.classList.toggle('scrolled', window.scrollY > SCROLL_GLASS);
        _scrollTicking = false;
      });
      _scrollTicking = true;
    }
  }, { passive: true });
}

// ---- boot ----
async function boot() {
  wire();
  renderIdlePills();
  renderBgPills();
  ensureIO();
  mountBackground();
  if (!window.vaultAPI) {
    // The page only runs inside the desktop app: window.vaultAPI is injected by
    // preload.js (Electron-only). A plain browser serving the same files via the
    // dev server has no bridge — explain that instead of a cryptic TypeError.
    show('welcome');
    console.warn('[vault] window.vaultAPI missing — this page only runs inside the My Vault desktop app');
    toast('this page only works inside the My Vault desktop app. open the app, not a browser.');
    return;
  }
  const last = await window.vaultAPI.getLastPath();
  if (last && (await tryLoad(last, true))) return;
  show('welcome');
  console.debug('[vault] boot ok — welcome screen');
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      console.debug('[vault] fonts loaded:',
        document.fonts.check('italic 16px "DM Serif Display"'),
        document.fonts.check('16px "Cormorant Garamond"'),
        document.fonts.check('16px "JetBrains Mono"'));
    });
  }
}

boot().catch((err) => {
  console.error(err);
  toast("something went wrong starting the vault. " + err.message);
});

// minimal test surface for the browser-based integration harness
// (same module instance — importing this URL again returns these without re-running boot)
export { state, handleFiles, openItem, lock };
