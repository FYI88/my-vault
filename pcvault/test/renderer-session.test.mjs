import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createSaveWriter } from '../src/save-writer.mjs';
import { createThumbnailQueue } from '../src/thumbnail-queue.mjs';

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
      removeAttribute() {}, pause() {}, load() {}, querySelectorAll: () => [],
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element, fullscreenElement: null },
    window: {}, clearTimeout() {}, setTimeout() {}, URL,
    console, TextDecoder, TextEncoder, Uint8Array, Blob,
    createSaveWriter,
    createThumbnailQueue,
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
      handleFiles, filteredItems, handleDelete, handleExport, enterWithDek };
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
