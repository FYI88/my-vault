import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serializeVault, parseVault } from '../src/container.mjs';
import { writeManifestAtomic } from '../vault-header.js';

test('streamed manifest changes preserve every payload byte, including header growth/shrink', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-header-'));
  const file = path.join(dir, 'test.cvault');
  try {
    const payload = new Uint8Array(4 * 1024 * 1024).fill(137);
    const items = [{ id: 'test', kind: 'video', photoLen: payload.length, photo: payload }];
    await writeFile(file, serializeVault({ tamperIdx: 0 }, items));
    for (const manifest of [{ tamperIdx: 10, prefs: { galleryStyle: 'phantom' } }, { tamperIdx: 1 }]) {
      await writeManifestAtomic(file, manifest);
      const parsed = parseVault(await readFile(file));
      assert.deepEqual(parsed.manifest, manifest);
      assert.deepEqual(parsed.items, items);
      assert.deepEqual(await readdir(dir), ['test.cvault']);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid source is preserved and no temporary copy remains', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-header-'));
  const file = path.join(dir, 'test.cvault');
  try {
    const original = Buffer.from('not a vault');
    await writeFile(file, original);
    await assert.rejects(writeManifestAtomic(file, { tamperIdx: 1 }), /invalid vault/);
    assert.deepEqual(await readFile(file), original);
    assert.deepEqual(await readdir(dir), ['test.cvault']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('empty vault can update its manifest', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-header-'));
  const file = path.join(dir, 'test.cvault');
  try {
    await writeFile(file, serializeVault({ tamperIdx: 0 }, []));
    await writeManifestAtomic(file, { tamperIdx: 0, prefs: {} });
    assert.deepEqual(parseVault(await readFile(file)).items, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
