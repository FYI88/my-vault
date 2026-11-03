import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import url from 'node:url';

const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
function harness() {
  const handlers = new Map();
  const events = new Map();
  let text = '';
  let settings = JSON.stringify({ vaultPath: 'old.cvault', bgFile: 'bg.png', other: true });
  let timer;
  let clipboardUnavailable = false;
  const formats = new Map();
  const electron = {
    app: { on: (name, fn) => events.set(name, fn), whenReady: () => ({ then() {} }), getPath: () => 'userdata' },
    protocol: { registerSchemesAsPrivileged() {} },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    clipboard: {
      writeText: (value) => { text = value; },
      writeBuffer: (name, bytes) => { formats.set(name, bytes); },
      readText: () => { if (clipboardUnavailable) throw new Error('clipboard busy'); return text; },
      clear: () => { text = ''; formats.clear(); },
    },
    dialog: { showOpenDialog: async () => ({ filePaths: ['new.cvault'] }),
      showSaveDialog: async () => ({ filePath: 'export.bin' }) },
  };
  let fileSize = 1;
  let reads = 0;
  let lastRead;
  let lastWrite;
  const fs = { promises: {
    stat: async () => ({ size: fileSize, isFile: () => true }),
    readFile: async () => { reads++; lastRead = Buffer.from([1]); return lastRead; },
    writeFile: async (p, bytes) => { lastWrite = bytes; },
  }, readFileSync: () => settings, writeFileSync: (p, value) => { settings = value; } };
  const modules = { electron, fs, path, crypto, url,
    './vault-header': { writeManifestAtomic: async () => {} },
    './vault-store': { createVaultStore: () => ({ path: (token) => {
      if (token !== 'valid') throw new Error('invalid vault session');
      return 'old.cvault';
    }, open: async () => ({ token: 'valid', items: [], manifest: {} }),
    read: async () => new Uint8Array([1]), save: async () => ({ byteLength: 10 }) }) } };
  vm.runInNewContext(source + '\nloadVaultPath(); loadBgPath();', {
    require: (name) => modules[name], __dirname: '.', process, Buffer,
    setTimeout: (fn) => { timer = fn; return 1; }, clearTimeout: () => { timer = null; },
  });
  return {
    invoke: (name, ...args) => handlers.get(name)({}, ...args),
    quit: () => events.get('before-quit')(),
    expire: () => timer(),
    clipboard: electron.clipboard,
    settings: () => JSON.parse(settings),
    setFileSize: (size) => { fileSize = size; },
    reads: () => reads,
    lastRead: () => lastRead,
    lastWrite: () => lastWrite,
    formats,
    clipboardUnavailable: (value) => { clipboardUnavailable = value; },
  };
}

test('transient Windows clipboard failure retains cleanup ownership and retries', () => {
  const h = harness();
  h.invoke('clip:copySecret', 'synthetic test');
  h.clipboardUnavailable(true);
  h.expire();
  h.clipboardUnavailable(false);
  h.expire();
  assert.equal(h.clipboard.readText(), '');
});

test('cleanup retry never erases different text copied during clipboard contention', () => {
  const h = harness();
  h.invoke('clip:copySecret', 'synthetic test');
  h.clipboardUnavailable(true);
  h.expire();
  h.clipboardUnavailable(false);
  h.clipboard.writeText('new unrelated text');
  h.expire();
  assert.equal(h.clipboard.readText(), 'new unrelated text');
});

for (const action of ['expire', 'lock', 'quit']) {
  test(`copied secret clears on ${action}, but a newer clipboard value survives`, () => {
    for (const replace of [false, true]) {
      const h = harness();
      h.invoke('clip:copySecret', 'password');
      if (replace) h.clipboard.writeText('something else');
      if (action === 'lock') h.invoke('clip:clearSecret');
      else h[action]();
      assert.equal(h.clipboard.readText(), replace ? 'something else' : '');
    }
  });
}

test('changing and forgetting the vault path preserve background and other settings', async () => {
  const h = harness();
  await h.invoke('vault:pickVaultFile');
  assert.equal(h.settings().vaultPath, 'new.cvault');
  assert.equal(h.settings().bgFile, 'bg.png');
  assert.equal(h.settings().other, true);
  h.invoke('vault:forgetPath');
  assert.equal(h.settings().vaultPath, null);
  assert.equal(h.settings().bgFile, 'bg.png');
  assert.equal(h.settings().other, true);
});

test('over-limit vault is refused before allocating a file buffer', async () => {
  const h = harness();
  h.setFileSize(2 ** 31);
  await assert.rejects(h.invoke('vault:readFile', 'old.cvault'), /VAULT_TOO_LARGE/);
  assert.equal(h.reads(), 0);
});

test('import size lookup rejects paths not selected by a dialog', async () => {
  const h = harness();
  await assert.rejects(h.invoke('vault:importFileSize', 'unselected.mp4'), /forbidden/);
  await h.invoke('vault:pickFiles');
  h.setFileSize(12345);
  assert.equal(await h.invoke('vault:importFileSize', 'new.cvault'), 12345);
  assert.equal(h.reads(), 0);
});

test('main read returns its existing buffer without an extra full-file copy', async () => {
  const h = harness();
  const bytes = await h.invoke('vault:readFile', 'old.cvault');
  assert.equal(bytes, h.lastRead());
});

test('export writes only the selected byte view without copying its buffer', async () => {
  const h = harness();
  const destination = await h.invoke('vault:saveFileAs', 'export.bin');
  const original = new Uint8Array([9, 1, 2, 9]);
  await h.invoke('vault:writeFile', destination, original.subarray(1, 3));
  assert.equal(h.lastWrite().buffer, original.buffer);
  assert.deepEqual([...h.lastWrite()], [1, 2]);
});

test('indexed IPC authorizes only the selected vault and its active session', async () => {
  const h = harness();
  await assert.rejects(h.invoke('vault:openIndexed', 'unselected.cvault'), /forbidden/);
  assert.equal((await h.invoke('vault:openIndexed', 'old.cvault')).token, 'valid');
  await assert.rejects(h.invoke('vault:readRecordChunk', 'invalid', 'doc', 0, 1), /session/);
  assert.deepEqual([...(await h.invoke('vault:readRecordChunk', 'valid', 'doc', 0, 1))], [1]);
  await h.invoke('vault:pickVaultFile');
  await assert.rejects(h.invoke('vault:readRecordChunk', 'valid', 'doc', 0, 1), /forbidden/);
  await assert.rejects(h.invoke('vault:saveIndexed', 'valid', {}, []), /forbidden/);
});
