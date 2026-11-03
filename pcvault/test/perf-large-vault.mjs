// Manual benchmark, NOT part of npm test. All generated data stays under the
// approved temp folder and is deleted after Electron exits.
import { mkdtemp, writeFile, readFile, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { createVault, bip39Generate, vaultImportAESKey, wrapItemKey, encText, encBytes, vaultWipeRaw } from '../src/vault-crypto.mjs';

const require = createRequire(import.meta.url);
const mib = Number(process.argv[2] || 256);
if (!Number.isInteger(mib) || mib < 32 || mib > 1800) throw new Error('Choose 32–1800 MiB');
const recordMiB = Number(process.argv.find((arg) => arg.startsWith('--record-mib='))?.split('=')[1] || 32);
if (!Number.isInteger(recordMiB) || recordMiB < 1 || recordMiB > 320) throw new Error('Choose record size 1–320 MiB');
const root = await mkdtemp(path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'vault-benchmark-'));
const profile = path.join(root, 'profile');
const { mkdir } = await import('node:fs/promises');
await mkdir(profile);
await writeFile(path.join(profile, 'PERF-ONLY'), 'synthetic');
const file = path.join(root, 'synthetic.cvault');
const smoke = process.argv.includes('--smoke');
const tamper = process.argv.includes('--tamper');
const videoRecords = process.argv.includes('--video-records');
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
try {
  const { manifest, dekRaw } = await createVault('Synthetic-test-only-482!', await bip39Generate());
  manifest.prefs = { galleryStyle: 'phantom' };
  const dek = await vaultImportAESKey(dekRaw);
  vaultWipeRaw(dekRaw);
  let videoTemplate;
  if (videoRecords) {
    const videoFile = path.join(root, 'template.mp4');
    await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoFile]);
    videoTemplate = await readFile(videoFile);
  }
  const out = await open(file, 'wx');
  try {
    const header = Buffer.from(JSON.stringify(manifest));
    await out.write(Buffer.concat([Buffer.from('CVLT'), u32(1), u32(header.length), header]));
    if (smoke) {
      const execute = promisify(execFile);
      const photoFile = path.join(root, 'test.jpg');
      const videoFile = path.join(root, 'test.mp4');
      await execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120', '-frames:v', '1', photoFile]);
      await execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoFile]);
      for (const [kind, name, mime, plain] of [
        ['photo', 'test.jpg', 'image/jpeg', await readFile(photoFile)],
        ['video', 'test.mp4', 'video/mp4', await readFile(videoFile)],
      ]) {
        const raw = crypto.getRandomValues(new Uint8Array(32));
        const key = await vaultImportAESKey(raw);
        const wrap = await wrapItemKey(dek, raw); vaultWipeRaw(raw);
        const encryptedName = await encText(key, name);
        const encrypted = await encBytes(key, plain);
        const json = Buffer.from(JSON.stringify({ id: `media-${kind}`, kind, mime, createdAt: 0, size: plain.length,
          nameIv: encryptedName.iv, name: encryptedName.data, iv: wrap.iv, itemKey: wrap.key,
          photoIv: encrypted.iv, photoLen: encrypted.data.length }));
        await out.write(Buffer.concat([u32(json.length), json]));
        await out.write(encrypted.data);
      }
    }
    for (let remaining = mib, i = 0; remaining > 0; i++) {
      const size = Math.min(recordMiB, remaining);
      const plain = new Uint8Array(size * 1024 * 1024);
      if (videoRecords) plain.set(videoTemplate);
      else for (let at = 0; at < plain.length; at += 65536) crypto.getRandomValues(plain.subarray(at, Math.min(at + 65536, plain.length)));
      const raw = crypto.getRandomValues(new Uint8Array(32));
      const key = await vaultImportAESKey(raw);
      const wrap = await wrapItemKey(dek, raw);
      vaultWipeRaw(raw);
      const name = await encText(key, `synthetic-${i}.${videoRecords ? 'mp4' : 'bin'}`);
      const encrypted = await encBytes(key, plain);
      vaultWipeRaw(plain);
      const metadata = Buffer.from(JSON.stringify({ id: `${videoRecords ? 'v' : 'd'}${String(i).padStart(4, '0')}`,
        kind: videoRecords ? 'video' : 'doc', mime: videoRecords ? 'video/mp4' : 'application/octet-stream',
        createdAt: 0, size: plain.length, nameIv: name.iv, name: name.data, iv: wrap.iv, itemKey: wrap.key,
        photoIv: encrypted.iv, photoLen: encrypted.data.length }));
      await out.write(Buffer.concat([u32(metadata.length), metadata]));
      await out.write(encrypted.data);
      remaining -= size;
    }
  } finally { await out.close(); }
  if (tamper) {
    // Flip only a byte in the first sampled synthetic payload. Keep the format
    // valid so this exercises integrity rejection, not a parser failure.
    const handle = await open(file, 'r+');
    try {
      const prefix = Buffer.alloc(12);
      await handle.read(prefix, 0, 12, 0);
      let offset = 12 + prefix.readUInt32LE(8);
      const length = Buffer.alloc(4);
      await handle.read(length, 0, 4, offset);
      offset += 4 + length.readUInt32LE();
      const byte = Buffer.alloc(1);
      await handle.read(byte, 0, 1, offset);
      byte[0] ^= 1;
      await handle.write(byte, 0, 1, offset);
    } finally { await handle.close(); }
  }
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ vaultPath: file }));
  console.log(`Synthetic ${mib} MiB ready (up to ${recordMiB} MiB per record); starting isolated Electron.`);
  const exit = await new Promise((resolve, reject) => {
    const env = { ...process.env, VAULT_PERF_PROFILE: profile, VAULT_PERF_FILE: file, VAULT_PERF_MIB: String(mib),
      VAULT_PERF_SMOKE: smoke ? '1' : '', VAULT_PERF_EXPECT_TAMPER: tamper ? '1' : '', VAULT_PERF_VIDEOS: videoRecords ? '1' : '' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [fileURLToPath(new URL('./perf-electron.cjs', import.meta.url))], { env, stdio: 'inherit' });
    let stopped = false;
    let sampling = false;
    const stop = (reason) => {
      if (stopped) return;
      stopped = true;
      console.log('VAULT_PERF_WATCHDOG ' + JSON.stringify({ reason, limitMiB: 4096 }));
      if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
      else child.kill('SIGKILL');
    };
    // Independent of Electron's event loop: a blocked main process cannot
    // disable this deadline or the process-tree memory guard.
    const deadline = setTimeout(() => stop('120s deadline'), 120000);
    const monitor = setInterval(() => {
      if (sampling || stopped || process.platform !== 'win32') return;
      sampling = true;
      const script = `$all=Get-CimInstance Win32_Process -Filter "name = 'electron.exe'"; ` +
        `$ids=@(${child.pid}); do { $old=$ids.Count; $ids=@($ids)+@($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object ProcessId); $ids=@($ids | Select-Object -Unique) } while($ids.Count -ne $old); ` +
        `(Get-Process -Id $ids -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`;
      execFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 10000 }, (error, stdout) => {
        sampling = false;
        if (!error && Number(stdout.trim()) > 4096 * 1024 ** 2) stop('synthetic Electron tree exceeded 4 GiB');
      });
    }, 1000);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearInterval(monitor); clearTimeout(deadline);
      resolve(stopped ? 1 : code);
    });
  });
  process.exitCode = exit || 0;
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  console.log('Synthetic vault/profile removed; real vault/settings untouched.');
}
