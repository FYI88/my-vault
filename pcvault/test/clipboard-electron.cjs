'use strict';
// Manual real-OS clipboard regression. Writes synthetic text; never prints or
// stores the user's previous clipboard. Uses an isolated temporary app profile.
const { app, clipboard } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-clipboard-'));
app.setPath('userData', profile);
const cleanupProfile = () => {
  setTimeout(() => fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }, () => {}), 1000).unref();
};
app.on('quit', cleanupProfile);
let done = false;
const finish = (code, result) => {
  if (done) return;
  done = true;
  console.log(JSON.stringify(result));
  app.exit(code);
};
app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const copied = await win.webContents.executeJavaScript(`window.vaultAPI.copySecret('Synthetic clipboard check 482!')`);
      const copiedCorrectly = clipboard.readText() === 'Synthetic clipboard check 482!';
      if (process.env.VAULT_CLIP_FORMAT_TEST) {
        clipboard.writeBuffer('CanIncludeInClipboardHistory', Buffer.alloc(4));
        finish(0, { textPreservedAfterCustomFormat: clipboard.readText() === 'Synthetic clipboard check 482!', formats: clipboard.availableFormats() });
        return;
      }
      const start = Date.now();
      setTimeout(() => finish(clipboard.readText() === '' ? 0 : 1, {
        copied, copiedCorrectly, elapsedMs: Date.now() - start,
        cleared: clipboard.readText() === '',
        stillSynthetic: clipboard.readText() === 'Synthetic clipboard check 482!',
        formats: clipboard.availableFormats(),
      }), 32000);
    } catch (error) { finish(1, { error: error.message }); }
  });
});
setTimeout(() => finish(1, { error: 'clipboard test timeout' }), 45000);
require('../main.js');
