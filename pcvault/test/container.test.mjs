// container.test.mjs — the single-file vault format must round-trip losslessly
// and reject anything that isn't a vault file.
import assert from 'node:assert/strict';
import { serializeVault, parseVault, MAX_RECORDS } from '../src/container.mjs';

let passTests = 0, failTests = 0;
async function t(name, fn) {
  passTests++;
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failTests++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

const manifest = {
  v: 1, createdAt: 1724000000000, iters: 600000, vaultId: 'aabbccddeeff0011',
  wrap: { salt: 'c2FsdA==', iv: 'aXZ2djs=', data: 'ZGF0YQ==' },
  seedWrap: { salt: 'c2FsdA==', iv: 'aXZ2djs=', data: 'ZGF0YQ==' },
  tamperIdx: 0,
};
const items = [
  { id: 'n1', kind: 'note', createdAt: 1724000000001, nameIv: 'aXY=', name: 'bmFtZQ==' },
  { id: 'p1', kind: 'photo', createdAt: 1724000000002, nameIv: 'aXY=', name: 'bmFtZQ==', iv: 'aXY=', itemKey: 'a2V5', photoIv: 'aXY=', photoLen: 4, photo: new Uint8Array([1, 2, 3, 4]) },
  { id: 'v1', kind: 'video', mime: 'video/mp4', size: 6, createdAt: 1724000000003, nameIv: 'aXY=', name: 'bmFtZQ==', iv: 'aXY=', itemKey: 'a2V5', photoIv: 'aXY=', photoLen: 6, photo: new Uint8Array([9, 8, 7, 6, 5, 4]) },
  { id: 'd1', kind: 'doc', mime: 'application/pdf', size: 3, createdAt: 1724000000004, nameIv: 'aXY=', name: 'bmFtZQ==', iv: 'aXY=', itemKey: 'a2V5', photoIv: 'aXY=', photoLen: 3, photo: new Uint8Array([25, 50, 44]) },
];

await t('serialize → parse round-trips manifest + items losslessly', () => {
  const bytes = serializeVault(manifest, items);
  const parsed = parseVault(bytes);
  assert.ok(parsed);
  assert.deepEqual(parsed.manifest, manifest);
  assert.equal(parsed.items.length, 4);
  assert.deepEqual(parsed.items[0], items[0]);
  const p1 = parsed.items[1];
  assert.equal(p1.id, 'p1');
  assert.deepEqual([...p1.photo], [1, 2, 3, 4]); // raw ciphertext bytes survive
  assert.equal(p1.photoLen, 4);
  delete p1.photo;
  assert.deepEqual({ ...p1, photo: undefined }, { ...items[1], photo: undefined });
});

await t('video record keeps mime + size + its raw bytes', () => {
  const bytes = serializeVault(manifest, items);
  const parsed = parseVault(bytes);
  const v1 = parsed.items.find((r) => r.id === 'v1');
  assert.equal(v1.kind, 'video');
  assert.equal(v1.mime, 'video/mp4');
  assert.equal(v1.size, 6);
  assert.deepEqual([...v1.photo], [9, 8, 7, 6, 5, 4]);
});

await t('doc record keeps mime + size + its raw bytes', () => {
  const bytes = serializeVault(manifest, items);
  const parsed = parseVault(bytes);
  const d1 = parsed.items.find((r) => r.id === 'd1');
  assert.equal(d1.kind, 'doc');
  assert.equal(d1.mime, 'application/pdf');
  assert.equal(d1.size, 3);
  assert.deepEqual([...d1.photo], [25, 50, 44]);
});

await t('file starts with the CVLT magic', () => {
  const bytes = serializeVault(manifest, []);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'CVLT');
});

await t('garbage bytes → null', () => {
  assert.equal(parseVault(new Uint8Array([9, 9, 9, 9, 1, 0, 0, 0])), null);
});

await t('truncated header → null', () => {
  const bytes = serializeVault(manifest, items);
  assert.equal(parseVault(bytes.subarray(0, 20)), null);
});

await t('truncated record → null', () => {
  const bytes = serializeVault(manifest, items);
  assert.equal(parseVault(bytes.subarray(0, bytes.length - 2)), null);
});

await t('empty file → null', () => {
  assert.equal(parseVault(new Uint8Array(0)), null);
});

await t('record count past MAX_RECORDS → null (SEC-010)', () => {
  // Build the hostile file by hand — serializeVault's spread-concat can't emit
  // 100k+ records, but a crafted file can, and parseVault must refuse it.
  const setU32 = (arr, off, v) => {
    arr[off] = v & 0xff; arr[off + 1] = (v >> 8) & 0xff;
    arr[off + 2] = (v >> 16) & 0xff; arr[off + 3] = (v >>> 24) & 0xff;
  };
  const rec = { id: 'n', kind: 'note', createdAt: 1, nameIv: 'aXY=', name: 'bmFtZQ==' };
  const json = new TextEncoder().encode(JSON.stringify(rec));
  const head = new TextEncoder().encode(JSON.stringify(manifest));
  const n = MAX_RECORDS + 1;
  const total = 4 + 4 + 4 + head.length + n * (4 + json.length);
  const bytes = new Uint8Array(total);
  bytes.set(new TextEncoder().encode('CVLT'), 0);
  setU32(bytes, 4, 1); // version
  setU32(bytes, 8, head.length);
  bytes.set(head, 12);
  let off = 12 + head.length;
  for (let i = 0; i < n; i++) { setU32(bytes, off, json.length); bytes.set(json, off + 4); off += 4 + json.length; }
  assert.equal(parseVault(bytes), null);
  const ok = parseVault(bytes.subarray(0, total - json.length - 4)); // exactly MAX_RECORDS → accepted
  assert.ok(ok);
  assert.equal(ok.items.length, MAX_RECORDS);
});

console.log(`\n${passTests - failTests}/${passTests} passed`);
process.exit(failTests ? 1 : 0);
