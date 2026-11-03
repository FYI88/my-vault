import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, readdir, rm, open, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { serializeVault, parseVault } from '../src/container.mjs';
import { createVaultStore, CHUNK_BYTES } from '../vault-store.js';

async function fixture(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-store-'));
  const file = path.join(dir, 'test.cvault');
  const manifest = { tamperIdx: 0, prefs: {} };
  const items = [
    { id: 'one', kind: 'video', photoLen: 1024, photo: new Uint8Array(1024).fill(137) },
    { id: 'two', kind: 'doc', photoLen: 17, photo: new Uint8Array(17).fill(42) },
  ];
  await writeFile(file, serializeVault(manifest, items));
  try { await run({ file, dir, manifest, items, store: createVaultStore() }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('opening returns only metadata and reads payload chunks on demand', () => fixture(async ({ file, items, store }) => {
  const index = await store.open(file);
  assert.equal(index.items.length, 2);
  assert.equal(index.items[0].photo, undefined);
  assert.equal(index.byteLength, (await stat(file)).size);
  assert.deepEqual([...await store.read(index.token, 'one', 10, 16)], [...items[0].photo.subarray(10, 26)]);
  const chunk = await store.read(index.token, 'two', 0);
  assert.equal(chunk.byteOffset, 0);
  assert.equal(chunk.buffer.byteLength, chunk.length);
  await assert.rejects(store.read('wrong-token', 'one', 0), /session/);
  await assert.rejects(store.read(index.token, 'missing', 0), /record/);
  await assert.rejects(store.read(index.token, 'one', -1), /range/);
  await assert.rejects(store.read(index.token, 'one', 0, CHUNK_BYTES + 1), /range/);
}));

test('new empty vault can adopt indexed storage and save its first record', () => fixture(async ({ file, manifest, store }) => {
  await writeFile(file, serializeVault(manifest, []));
  const index = await store.open(file);
  assert.equal(index.items.length, 0);
  const record = { id: 'first', photoLen: 3, photo: new Uint8Array([1, 2, 3]) };
  const { photo, ...metadata } = record;
  await store.save(index.token, manifest, [{ metadata, photo }]);
  assert.deepEqual(parseVault(await readFile(file)).items, [record]);
}));

test('metadata-only opening does not read a single payload byte', () => fixture(async ({ file, store }) => {
  const originalOpen = fs.promises.open;
  let total = 0;
  fs.promises.open = async function (...args) {
    const handle = await originalOpen.apply(this, args);
    const read = handle.read.bind(handle);
    handle.read = async (...values) => {
      const result = await read(...values);
      total += result.bytesRead;
      return result;
    };
    return handle;
  };
  let index;
  try { index = await store.open(file); }
  finally { fs.promises.open = originalOpen; }
  const payloadBytes = index.items.reduce((sum, record) => sum + record.photoLen, 0);
  assert.equal(total, index.byteLength - payloadBytes);
}));

test('streamed saves preserve byte-for-byte compatibility for reorder/delete/add', () => fixture(async ({ file, manifest, items, store }) => {
  const index = await store.open(file);
  const added = { id: 'new', kind: 'secret', photoLen: 3, photo: new Uint8Array([4, 5, 6]) };
  const nextManifest = { ...manifest, tamperIdx: 1, prefs: { galleryStyle: 'drift' } };
  const expected = [items[1], added];
  const plan = expected.map(({ photo, ...metadata }) => ({ metadata, ...(metadata.id === 'new' ? { photo } : {}) }));
  await store.save(index.token, nextManifest, plan);
  assert.deepEqual(new Uint8Array(await readFile(file)), serializeVault(nextManifest, expected));
  assert.deepEqual([...await store.read(index.token, 'new', 0)], [4, 5, 6]);
  assert.deepEqual([...await store.read(index.token, 'two', 0)], [...items[1].photo]);
  await assert.rejects(store.read(index.token, 'one', 0), /record/);
}));

test('failed save leaves original bytes and no temporary file', () => fixture(async ({ file, dir, manifest, store }) => {
  const index = await store.open(file);
  const original = await readFile(file);
  await assert.rejects(store.save(index.token, manifest, [{ metadata: { id: 'missing', photoLen: 10 } }]), /record/);
  assert.deepEqual(await readFile(file), original);
  assert.deepEqual(await readdir(dir), ['test.cvault']);
}));

test('disk write failure after temp creation preserves the original and cleans up', () => fixture(async ({ file, dir, manifest, items, store }) => {
  const index = await store.open(file);
  const original = await readFile(file);
  const originalOpen = fs.promises.open;
  fs.promises.open = async function (filename, flags, ...args) {
    const handle = await originalOpen.call(this, filename, flags, ...args);
    if (String(filename).startsWith(file + '.tmp-')) {
      handle.write = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
    }
    return handle;
  };
  try {
    await assert.rejects(store.save(index.token, manifest,
      items.map(({ photo, ...metadata }) => ({ metadata }))), /disk full/);
  } finally { fs.promises.open = originalOpen; }
  assert.deepEqual(await readFile(file), original);
  assert.deepEqual(await readdir(dir), ['test.cvault']);
  assert.deepEqual([...await store.read(index.token, 'two', 0)], [...items[1].photo]);
}));

test('rename failure preserves the original and allows a later retry', () => fixture(async ({ file, dir, manifest, items, store }) => {
  const index = await store.open(file);
  const original = await readFile(file);
  const originalRename = fs.promises.rename;
  fs.promises.rename = async () => { throw new Error('file locked'); };
  const plan = items.map(({ photo, ...metadata }) => ({ metadata }));
  try { await assert.rejects(store.save(index.token, manifest, plan), /file locked/); }
  finally { fs.promises.rename = originalRename; }
  assert.deepEqual(await readFile(file), original);
  assert.deepEqual(await readdir(dir), ['test.cvault']);
  await store.save(index.token, { ...manifest, tamperIdx: 1 }, plan);
  assert.equal(parseVault(await readFile(file)).manifest.tamperIdx, 1);
}));

test('externally changed files are never silently read or overwritten', () => fixture(async ({ file, manifest, store }) => {
  const index = await store.open(file);
  await writeFile(file, new Uint8Array([1]));
  await assert.rejects(store.read(index.token, 'one', 0), /VAULT_CHANGED/);
  await assert.rejects(store.save(index.token, manifest, []), /VAULT_CHANGED/);
  assert.deepEqual([...await readFile(file)], [1]);
}));

test('opening another vault invalidates every previous record-read token', () => fixture(async ({ file, dir, manifest, items, store }) => {
  const original = await store.open(file);
  const nextFile = path.join(dir, 'second.cvault');
  await writeFile(nextFile, serializeVault(manifest, items));
  const next = await store.open(nextFile);
  await assert.rejects(store.read(original.token, 'one', 0), /session/);
  await assert.rejects(store.save(original.token, manifest, []), /session/);
  assert.deepEqual([...await store.read(next.token, 'two', 0)], [...items[1].photo]);
}));

test('queued saves retain new payloads and later reads use refreshed offsets', () => fixture(async ({ file, manifest, store }) => {
  const index = await store.open(file);
  const metadata = { id: 'new', kind: 'doc', photoLen: 2 };
  await Promise.all([
    store.save(index.token, manifest, [{ metadata, photo: new Uint8Array([1, 2]) }]),
    store.save(index.token, { tamperIdx: 2 }, [{ metadata }]),
  ]);
  assert.deepEqual([...await store.read(index.token, 'new', 0)], [1, 2]);
  assert.equal(parseVault(await readFile(file)).manifest.tamperIdx, 2);
}));

test('malformed lengths, duplicate ids and truncated payloads are refused', () => fixture(async ({ file, manifest, store }) => {
  const cases = [
    new Uint8Array([1, 2]),
    serializeVault(manifest, [{ id: 'a', photoLen: -1 }]),
    serializeVault(manifest, [{ id: 'a', photoLen: 100 }]),
    serializeVault(manifest, [{ id: 'a' }, { id: 'a' }]),
  ];
  for (const bytes of cases) {
    await writeFile(file, bytes);
    await assert.rejects(store.open(file), /VAULT_INVALID/);
  }
}));

test('metadata-only opening works above the legacy 2 GiB whole-read ceiling', () => fixture(async ({ file, manifest, store }) => {
  const first = { id: 'large-one', kind: 'video', photoLen: 1100 * 1024 ** 2 };
  const second = { id: 'large-two', kind: 'video', photoLen: 1100 * 1024 ** 2 };
  const head = serializeVault(manifest, []);
  const handle = await open(file, 'w');
  try {
    await handle.write(head);
    let offset = head.length;
    for (const metadata of [first, second]) {
      const json = Buffer.from(JSON.stringify(metadata));
      const length = Buffer.alloc(4); length.writeUInt32LE(json.length);
      await handle.write(length, 0, 4, offset); offset += 4;
      await handle.write(json, 0, json.length, offset); offset += json.length + metadata.photoLen;
    }
    await handle.truncate(offset);
  } finally { await handle.close(); }
  const index = await store.open(file);
  assert(index.byteLength > 2 ** 31);
  assert.equal(index.items.length, 2);
  assert.equal(index.items[0].photo, undefined);
}));
