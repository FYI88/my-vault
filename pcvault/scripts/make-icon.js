// make-icon.js — renders build/icon.svg into PNGs and a multi-size .ico using
// the project's own Electron (Chromium) — no ImageMagick needed.
// Dev-only tool: build/ and scripts/ are NOT shipped in the packaged app.
//   Run: npx electron scripts/make-icon.js
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 64, 128, 256];
const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'build', 'icon.svg');
const OUT = path.join(ROOT, 'build');

// ICO container wrapping PNG-compressed entries (valid on Windows Vista+).
function writeIco(entries, outPath) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dirs = [];
  const blobs = [];
  let offset = 6 + 16 * entries.length;
  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    dir.writeUInt8(size >= 256 ? 0 : size, 1);
    dir.writeUInt8(0, 2); // color count (unused for PNG)
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += png.length;
    dirs.push(dir);
    blobs.push(png);
  }
  fs.writeFileSync(outPath, Buffer.concat([header, ...dirs, ...blobs]));
}

app.whenReady().then(async () => {
  // Paint the SVG in a regular Chromium window before capture. Hidden/offscreen
  // capture can fail with UnknownVizError on some Windows GPU configurations.
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    useContentSize: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(SVG);
  win.show();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const full = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  win.destroy();

  const entries = [];
  for (const size of SIZES) {
    const png = full.resize({ width: size, height: size }).toPNG();
    fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png);
    if (size === 32) fs.copyFileSync(path.join(OUT, 'icon-32.png'), path.join(ROOT, 'src', 'favicon.png'));
    entries.push({ size, png });
    console.log(`icon-${size}.png — ${png.length} bytes`);
  }
  writeIco(entries, path.join(OUT, 'icon.ico'));
  console.log('build/icon.ico — ' + fs.statSync(path.join(OUT, 'icon.ico')).size + ' bytes');
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
