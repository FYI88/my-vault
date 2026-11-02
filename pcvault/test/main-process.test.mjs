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
  const electron = {
    app: { on: (name, fn) => events.set(name, fn), whenReady: () => ({ then() {} }), getPath: () => 'userdata' },
    protocol: { registerSchemesAsPrivileged() {} },
    ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn) },
    clipboard: { writeText: (value) => { text = value; }, readText: () => text, clear: () => { text = ''; } },
    dialog: { showOpenDialog: async () => ({ filePaths: ['new.cvault'] }) },
  };
  const fs = { promises: {}, readFileSync: () => settings, writeFileSync: (p, value) => { settings = value; } };
  const modules = { electron, fs, path, crypto, url, './vault-header': { writeManifestAtomic: async () => {} } };
  vm.runInNewContext(source + '\nloadVaultPath(); loadBgPath();', {
    require: (name) => modules[name], __dirname: '.', process,
    setTimeout: (fn) => { timer = fn; return 1; }, clearTimeout: () => { timer = null; },
  });
  return {
    invoke: (name, ...args) => handlers.get(name)({}, ...args),
    quit: () => events.get('before-quit')(),
    expire: () => timer(),
    clipboard: electron.clipboard,
    settings: () => JSON.parse(settings),
  };
}

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
