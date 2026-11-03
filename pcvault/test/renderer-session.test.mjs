import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createSaveWriter } from '../src/save-writer.mjs';
import { createThumbnailQueue } from '../src/thumbnail-queue.mjs';
import { readRecordBytes, checkIndexedIntegrity } from '../src/record-access.mjs';
import { verifyRecordInWorker } from '../src/integrity-client.mjs';
import { MAX_VAULT_BYTES, WARN_VAULT_BYTES, vaultByteLength, importFits } from '../src/vault-limits.mjs';

// Evaluate the entire renderer without booting Electron. Only imports and the
// boot entry point are replaced; tests exercise the real async UI functions.
const source = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8')
  .replace(/^import\s+[\s\S]*?from\s+'[^']+';\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(new URL('../src/renderer.js', import.meta.url).href))
  .replace(/boot\(\)\.catch\(\(err\) => \{[\s\S]*?\n\}\);/, '')
  .replace(/^export \{[^}]+\};/m, '');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(overrides = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', value: '', title: '', dataset: {},
      classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute() {}, pause() {}, load() {}, select() {}, querySelectorAll: () => [],
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, fullscreenElement: null },
    window: {}, clearTimeout() {}, setTimeout() {}, URL,
    console, TextDecoder, TextEncoder, Uint8Array, Blob,
    requestAnimationFrame: (fn) => queueMicrotask(fn),
    createSaveWriter,
    createThumbnailQueue,
    readRecordBytes, checkIndexedIntegrity,
    verifyRecordInWorker,
    MAX_VAULT_BYTES, WARN_VAULT_BYTES, vaultByteLength, importFits,
    unwrapItemKey: async () => ({}), decText: async () => 'private.txt',
    decBytes: async () => new TextEncoder().encode('PRIVATE'),
    vaultWipeRaw: (bytes) => bytes?.fill(0), emptyYear: (year) => ({ year, days: {} }),
    ...overrides,
  });
  vm.runInContext(source + `
    showVaultTab = resetViewerZoom = closePdf = setChromeHidden =
      destroyGallery = hideGalleryProgress = resetIdle = pokeChrome = () => {};
    show = () => {};
    globalThis.ui = { state, lock, openItem, decryptSecret, journalForYear,
      getLifeData, ensureNames, thumbUrl, closeItemOverlay, viewerNav,
      handleFiles, filteredItems, handleDelete, handleExport, enterWithDek,
      handleUnlock, handleSeedRecovery, tryLoad, saveVault, recordBytes,
      verifyRecordsFromDisk, canAutoThumbnail };
  `, context);
  context.ui.state.unlocked = true;
  context.ui.state.dek = {};
  return { ...context.ui, context, element };
}

for (const relock of [false, true]) {
  test(`late viewer plaintext is discarded after lock${relock ? ' and immediate unlock' : ''}`, async () => {
    const name = deferred();
    const h = harness({ decText: () => name.promise });
    h.state.items = [{ id: 'doc', kind: 'doc', mime: 'text/plain', createdAt: 0 }];
    const opening = h.openItem('doc');
    await Promise.resolve();
    h.lock();
    if (relock) { h.state.unlocked = true; h.state.dek = {}; }
    name.resolve('private.txt');
    await opening;
    assert.equal(h.element('itemTitle').textContent, '');
    assert.equal(h.element('itemTextContent').textContent, '');
  });
}

test('closing the viewer invalidates a pending decrypt immediately', async () => {
  const name = deferred();
  const h = harness({ decText: () => name.promise, reducedMotion: () => false });
  h.state.items = [{ id: 'doc', kind: 'doc', mime: 'text/plain', createdAt: 0 }];
  const opening = h.openItem('doc');
  await Promise.resolve();
  h.closeItemOverlay();
  name.resolve('private.txt');
  await opening;
  assert.equal(h.element('itemTextContent').textContent, '');
});

test('an active session can still open and display a text file', async () => {
  const h = harness();
  h.state.items = [{ id: 'doc', kind: 'doc', mime: 'text/plain', createdAt: 0 }];
  await h.openItem('doc');
  assert.equal(h.element('itemTextContent').textContent, 'PRIVATE');
  assert.equal(h.element('itemTitle').title, 'private.txt');
});

test('a late journal decrypt cannot refill a new session cache', async () => {
  const bytes = deferred();
  const h = harness({ decBytes: () => bytes.promise, parseYearJSON: JSON.parse });
  h.state.items = [{ id: 'journal', kind: 'journal', year: 2026 }];
  const pending = h.journalForYear(2026);
  await Promise.resolve();
  h.lock(); h.state.unlocked = true;
  bytes.resolve(new TextEncoder().encode('{"days":{"private":{"text":"PRIVATE"}}}'));
  await pending;
  assert.equal(h.state.journalCache.size, 0);
});

test('secret and life decrypts cannot refill caches in a new session', async () => {
  for (const kind of ['secret', 'life']) {
    const bytes = deferred();
    const h = harness({ decBytes: () => bytes.promise });
    const rec = { id: kind, kind };
    h.state.items = [rec];
    const pending = kind === 'secret' ? h.decryptSecret(rec) : h.getLifeData();
    await Promise.resolve();
    h.lock(); h.state.unlocked = true; h.state.dek = {};
    bytes.resolve(new TextEncoder().encode(JSON.stringify({ secret: 'PRIVATE', dob: '2000-01-01' })));
    assert.equal(await pending, null);
    assert.equal(h.state.secretsCache.size, 0);
    assert.equal(h.state.lifeCache, null);
  }
});

test('old name indexing cannot refill the cache after a lock/unlock', async () => {
  const name = deferred();
  const h = harness({ decText: () => name.promise });
  h.state.items = [{ id: 'doc' }];
  const indexing = h.ensureNames();
  await Promise.resolve();
  h.lock(); h.state.unlocked = true;
  name.resolve('private.txt');
  await indexing;
  assert.equal(h.state.nameCache.size, 0);
});

test('stale thumbnails never create a decrypted object URL', async () => {
  const bytes = deferred();
  let urls = 0;
  class TestURL extends URL {
    static revokeObjectURL() {}
    static createObjectURL() { urls++; return 'blob:test'; }
  }
  const h = harness({ decBytes: () => bytes.promise, URL: TestURL });
  const pending = h.thumbUrl({ id: 'photo' });
  await Promise.resolve();
  h.lock(); h.state.unlocked = true;
  bytes.resolve(new Uint8Array([1]));
  await assert.rejects(pending, /session ended/);
  assert.equal(urls, 0);
  assert.equal(h.state.urls.size, 0);
});

test('viewer navigation and count exclude internal records', async () => {
  const h = harness();
  h.state.items = [
    { id: 'one', kind: 'doc', mime: 'text/plain' },
    { id: 'secret', kind: 'secret' }, { id: 'journal', kind: 'journal' },
    { id: 'life', kind: 'life' }, { id: 'two', kind: 'doc', mime: 'text/plain' },
  ];
  await h.openItem('one');
  assert.equal(h.element('viewerCount').textContent, '1 of 2');
  h.viewerNav(1);
  assert.equal(h.element('viewerCount').textContent, '2 of 2');
  for (const id of ['secret', 'journal', 'life']) await h.openItem(id);
  assert.equal(h.element('viewerCount').textContent, '2 of 2');
});

test('name indexing skips internal records', async () => {
  let decrypts = 0;
  const h = harness({ decText: async () => { decrypts++; return 'file.txt'; } });
  h.state.items = [{ id: 'doc', kind: 'doc' }, { id: 'secret', kind: 'secret' }];
  await h.ensureNames();
  assert.equal(decrypts, 1);
  assert.equal(h.state.nameCache.has('secret'), false);
});

test('import after initial name indexing is immediately searchable', async () => {
  const h = harness();
  await h.ensureNames();
  vm.runInContext(`encryptFile = async () => ({ id: 'new', kind: 'doc' });
    renderGrid = () => {};`, h.context);
  await h.handleFiles([{ name: 'NewFile.txt', type: 'text/plain', size: 1,
    arrayBuffer: async () => new Uint8Array([1]).buffer }]);
  h.state.searchQuery = 'newfile';
  assert.equal((await h.filteredItems())[0].id, 'new');
});

test('viewer releases its full-size media URL on navigation and close', async () => {
  const revoked = [];
  let count = 0;
  class TestURL extends URL {
    static createObjectURL() { return `blob:${++count}`; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const h = harness({ URL: TestURL });
  vm.runInContext('reducedMotion = () => true;', h.context);
  h.state.items = [{ id: 'one', kind: 'video' }, { id: 'two', kind: 'video' }];
  await h.openItem('one');
  await h.openItem('two');
  assert.deepEqual(revoked, ['blob:1']);
  h.closeItemOverlay();
  assert.deepEqual(revoked, ['blob:1', 'blob:2']);
  assert.equal(h.state.urls.size, 0);
});

test('ordinary unlock persists its integrity cursor without serializing file payloads', async () => {
  let fullSerializations = 0;
  const headers = [];
  const h = harness({
    serializeVault: () => { fullSerializations++; return new Uint8Array(); },
    window: { vaultAPI: {
      writeFileAtomic: async () => {},
      writeManifestAtomic: async (path, manifest) => headers.push({ path, manifest }),
    } },
    tamperSample: async () => ({ tampered: false, tamperIdx: 3 }),
  });
  vm.runInContext(`adoptGalleryStyleIntoFile = () => false;
    adoptLifeFromLocalStorage = async () => false;
    unlockBeat = async () => {};
    renderGrid = () => {};`, h.context);
  h.state.path = 'large.cvault';
  h.state.manifest = { tamperIdx: 0 };
  h.state.unlocked = false;
  await h.enterWithDek({});
  assert.equal(h.state.unlocked, true);
  assert.equal(fullSerializations, 0, 'unlock must not allocate a whole-vault snapshot');
  assert.equal(headers.length, 1);
  assert.equal(headers[0].manifest.tamperIdx, 3);
});

function authHarness({ seed = false, tampered = false, saveFails = false, raw } = {}) {
  const stages = [];
  let readStatus;
  const capture = () => { stages.push(readStatus()); };
  const h = harness({
    unlockWithPass: async () => { capture(); return raw === undefined ? new Uint8Array([1]) : raw; },
    unlockWithSeed: async () => { capture(); return raw === undefined ? new Uint8Array([1]) : raw; },
    vaultImportAESKey: async () => ({}),
    tamperSample: async () => { capture(); return { tampered, tamperIdx: 1 }; },
    window: { vaultAPI: { writeManifestAtomic: async () => {
      capture();
      if (saveFails) throw new Error('disk full');
    } } },
  });
  readStatus = () => h.element('unlockStatus').textContent;
  vm.runInContext(`adoptGalleryStyleIntoFile = () => false;
    adoptLifeFromLocalStorage = async () => false;
    unlockBeat = async () => {};
    shake = () => {};
    toast = () => {};
    renderGrid = () => {};
    show = async (name) => { if (name === 'unlocked') globalThis.onOpen(); };`, h.context);
  h.context.onOpen = capture;
  h.state.path = 'test.cvault';
  h.state.manifest = { tamperIdx: 0 };
  h.state.unlocked = false;
  const input = h.element(seed ? 'seedRecoveryInput' : 'unlockPass');
  input.value = 'test';
  const btn = h.element(seed ? 'recoverySubmit' : 'unlockBtn');
  h.element('seedRecoveryForm').querySelector = () => btn;
  const run = () => seed
    ? h.handleSeedRecovery({ preventDefault() {}, target: h.element('seedRecoveryForm') })
    : h.handleUnlock({ preventDefault() {} });
  return { ...h, stages, run, input, btn };
}

for (const seed of [false, true]) {
  test(`${seed ? 'recovery' : 'password'} unlock reports real stages and resets busy status`, async () => {
    const h = authHarness({ seed });
    await h.run();
    assert.deepEqual(h.stages, [seed ? 'checking recovery words…' : 'checking password…',
      'checking vault integrity…', 'saving vault state…', 'opening your vault…']);
    assert.equal(h.element('unlockStatus').textContent, '');
    assert.equal(h.btn.disabled, false);
    assert.equal(h.input.readOnly, false);
    assert.equal(h.state.unlocked, true);
  });

  test(`${seed ? 'recovery' : 'password'} failure stays locked and allows retry`, async () => {
    const h = authHarness({ seed, raw: null });
    await h.run();
    assert.equal(h.state.unlocked, false);
    assert.equal(h.btn.disabled, false);
    assert.match(h.element(seed ? 'seedRecoveryErr' : 'unlockErr').textContent, /wrong|don't unlock/);
    assert.equal(h.element('unlockStatus').textContent, '');
    await h.run();
    assert.equal(h.stages.length, 2);
  });
}

test('integrity failure never reaches saving/opening status', async () => {
  const h = authHarness({ tampered: true });
  await h.run();
  assert.equal(h.state.unlocked, false);
  assert.deepEqual(h.stages, ['checking password…', 'checking vault integrity…']);
  assert.equal(h.element('unlockStatus').textContent, '');
});

test('save failure stays locked and successful retry can open', async () => {
  const h = authHarness({ saveFails: true });
  await h.run();
  assert.equal(h.state.unlocked, false);
  assert.match(h.element('unlockErr').textContent, /disk space/);
  assert.equal(h.stages.includes('opening your vault…'), false);
  h.context.window.vaultAPI.writeManifestAtomic = async () => {};
  await h.run();
  assert.equal(h.state.unlocked, true);
  assert.equal(h.element('unlockErr').textContent, '');
});

test('old unlock completion cannot reset a newer request status', async () => {
  const h = authHarness();
  const old = deferred();
  const next = deferred();
  h.context.unlockWithPass = () => old.promise;
  const first = h.run();
  await new Promise((resolve) => setImmediate(resolve));
  h.lock();
  h.context.unlockWithPass = () => next.promise;
  const second = h.run();
  await new Promise((resolve) => setImmediate(resolve));
  old.resolve(new Uint8Array([1]));
  await first;
  assert.equal(h.element('unlockStatus').textContent, 'checking password…');
  assert.equal(h.btn.disabled, true);
  next.resolve(new Uint8Array([1]));
  await second;
  assert.equal(h.state.unlocked, true);
});

test('too-large remembered vault preserves its saved location', async () => {
  let forgotten = false;
  let message = '';
  const h = harness({ window: { vaultAPI: {
    readFile: async () => { throw new Error('VAULT_TOO_LARGE'); },
    forgetPath: async () => { forgotten = true; },
  } } });
  h.context.report = (text) => { message = text; };
  vm.runInContext('toast = (text) => report(text);', h.context);
  assert.equal(await h.tryLoad('large.cvault', true), false);
  assert.equal(forgotten, false);
  assert.match(message, /saved location have been kept/);
});

test('drag/drop capacity guard runs before reading or encrypting file bytes', async () => {
  let read = false;
  const h = harness();
  vm.runInContext('toast = () => {};', h.context);
  await h.handleFiles([{ name: 'large.mp4', size: MAX_VAULT_BYTES,
    arrayBuffer: async () => { read = true; throw new Error('must not read'); } }]);
  assert.equal(read, false);
  assert.equal(h.state.items.length, 0);
});

test('password submission is ignored while the vault is still loading', async () => {
  const h = authHarness();
  h.state.loading = true;
  await h.run();
  assert.equal(h.stages.length, 0);
  assert.equal(h.element('unlockErr').textContent, '');
});

test('unlock completes even when animation frames are suspended', { timeout: 1500 }, async () => {
  const h = authHarness();
  h.context.requestAnimationFrame = () => 1; // Windows may occlude/minimize the window
  h.context.cancelAnimationFrame = () => {};
  h.context.setTimeout = setTimeout;
  h.context.clearTimeout = clearTimeout;
  await h.run();
  assert.equal(h.state.unlocked, true);
  assert.equal(h.element('unlockStatus').textContent, '');
});

test('indexed open loads metadata only, without invoking the full-file reader', async () => {
  let wholeReads = 0;
  const h = harness({ window: { vaultAPI: {
    openIndexed: async () => ({ token: 'disk', manifest: { tamperIdx: 0 }, items: [{ id: 'doc', photoLen: 100 }], byteLength: 200 }),
    readFile: async () => { wholeReads++; throw new Error('must not read whole vault'); },
  } } });
  vm.runInContext('refreshPathLines = () => {};', h.context);
  assert.equal(await h.tryLoad('indexed.cvault', false), true);
  assert.equal(h.state.storeToken, 'disk');
  assert.equal(h.state.items[0].photo, undefined);
  assert.equal(wholeReads, 0);
});

test('stale indexed open cannot replace a more recently loaded vault', async () => {
  const firstIndex = deferred();
  const h = harness({ window: { vaultAPI: {
    openIndexed: (path) => path === 'first' ? firstIndex.promise
      : Promise.resolve({ token: 'second', manifest: {}, items: [], byteLength: 0 }),
  } } });
  vm.runInContext('refreshPathLines = () => {};', h.context);
  const first = h.tryLoad('first', false);
  const second = h.tryLoad('second', false);
  assert.equal(await second, true);
  firstIndex.resolve({ token: 'first', manifest: {}, items: [], byteLength: 0 });
  assert.equal(await first, false);
  assert.equal(h.state.storeToken, 'second');
  assert.equal(h.state.loading, false);
});

test('locking during indexed loading cancels the pending result and releases busy controls', async () => {
  const loading = deferred();
  const h = harness({ window: { vaultAPI: { openIndexed: () => loading.promise } } });
  const pending = h.tryLoad('indexed.cvault', false);
  assert.equal(h.state.loading, true);
  h.lock();
  loading.resolve({ token: 'disk', manifest: {}, items: [], byteLength: 100 });
  assert.equal(await pending, false);
  assert.equal(h.state.loading, false);
  assert.equal(h.element('unlockBtn').disabled, false);
  assert.equal(h.state.manifest, null);
});

test('indexed saves release committed ciphertext and retain it when persistence fails', async () => {
  let fail = true;
  let calls = 0;
  const h = harness({ window: { vaultAPI: { saveIndexed: async (token, manifest, records) => {
    calls++;
    assert.equal(token, 'disk');
    assert.equal(records[0].photo.length, 3);
    if (fail) throw new Error('disk full');
    return { byteLength: 100 };
  } } } });
  vm.runInContext('toast = () => {};', h.context);
  h.state.path = 'indexed.cvault'; h.state.storeToken = 'disk'; h.state.manifest = {};
  h.state.items = [{ id: 'doc', photoLen: 3, photo: new Uint8Array([1, 2, 3]) }];
  await assert.rejects(h.saveVault(), /disk full/);
  assert.equal(h.state.items[0].photo.length, 3);
  fail = false;
  await h.saveVault();
  assert.equal(h.state.items[0].photo, undefined);
  assert.equal(calls, 2);
});

test('indexed text viewer fetches only its own ciphertext and discards it afterward', async () => {
  const ids = [];
  const h = harness({ window: { vaultAPI: { readRecordChunk: async (token, id, offset, length) => {
    ids.push(id); return new Uint8Array(length).fill(1);
  } } } });
  h.state.storeToken = 'disk';
  h.state.items = [{ id: 'doc', kind: 'doc', mime: 'text/plain', photoLen: 10 }];
  await h.openItem('doc');
  assert.equal(h.element('itemTextContent').textContent, 'PRIVATE');
  assert.deepEqual(ids, ['doc']);
  assert.equal(h.state.items[0].photo, undefined);
});

test('indexed originals verification reads disk rather than unsaved in-memory ciphertext', async () => {
  let read = false;
  const h = harness({ window: { vaultAPI: { readRecordChunk: async () => { read = true; return new Uint8Array([1, 2, 3]); } } },
    decBytes: async (key, iv, bytes) => bytes });
  h.state.storeToken = 'disk';
  h.state.items = [{ id: 'doc', photoLen: 3, size: 3, photo: new Uint8Array([9, 9, 9]) }];
  assert.equal(await h.verifyRecordsFromDisk([{ id: 'doc', name: 'test' }]), null);
  assert.equal(read, true);
});

test('large video tiles never trigger automatic full-record preview decrypts', () => {
  const h = harness();
  assert.equal(h.canAutoThumbnail({ kind: 'photo', photoLen: 100 }), true);
  assert.equal(h.canAutoThumbnail({ kind: 'video', photoLen: 1024 }), true);
  assert.equal(h.canAutoThumbnail({ kind: 'video', photoLen: 264 * 1024 ** 2 }), false);
  assert.equal(h.canAutoThumbnail({ kind: 'doc', photoLen: 1024 }), false);
});
