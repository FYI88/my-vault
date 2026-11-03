import assert from 'node:assert/strict';
import test from 'node:test';
import { readRecordBytes, checkIndexedIntegrity } from '../src/record-access.mjs';
import { createVault, bip39Generate, vaultImportAESKey, wrapItemKey, encText, encBytes, tamperSample, vaultWipeRaw } from '../src/vault-crypto.mjs';

test('record loader bounds bridge messages and preserves all bytes', async () => {
  const source = new Uint8Array(9 * 1024 * 1024 + 17).fill(137);
  const requests = [];
  const bytes = await readRecordBytes({ photoLen: source.length }, async (offset, length) => {
    requests.push(length);
    return source.subarray(offset, offset + length);
  });
  assert.deepEqual(bytes, source);
  assert.equal(requests.length, 3);
  assert(Math.max(...requests) <= 4 * 1024 ** 2);
});

test('cancellation stops the next chunk and truncated chunks are refused', async () => {
  let valid = true;
  let reads = 0;
  await assert.rejects(readRecordBytes({ photoLen: 8 * 1024 ** 2 }, async (offset, length) => {
    reads++; valid = false; return new Uint8Array(length);
  }, () => valid), /session ended/);
  assert.equal(reads, 1);
  await assert.rejects(readRecordBytes({ photoLen: 10 }, async () => new Uint8Array(9)), /truncated/);
});

test('indexed integrity checks select and verify exactly the original sample', async () => {
  const { manifest, dekRaw } = await createVault('Synthetic-test-only-482!', await bip39Generate());
  const dek = await vaultImportAESKey(dekRaw); vaultWipeRaw(dekRaw);
  const items = [];
  for (let i = 0; i < 5; i++) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await vaultImportAESKey(raw);
    const wrap = await wrapItemKey(dek, raw); vaultWipeRaw(raw);
    const name = await encText(key, `test-${i}`);
    const encrypted = await encBytes(key, new Uint8Array([i, 2, 3]));
    items.push({ id: `item-${i}`, nameIv: name.iv, name: name.data, iv: wrap.iv,
      itemKey: wrap.key, photoIv: encrypted.iv, photoLen: encrypted.data.length, photo: encrypted.data });
  }
  const metadata = items.map(({ photo, ...record }) => record);
  for (const cursor of [0, 2, 4]) {
    manifest.tamperIdx = cursor;
    const loaded = [];
    const actual = await checkIndexedIntegrity(manifest, dek, metadata, async (record) => {
      loaded.push(record.id); return items.find((r) => r.id === record.id).photo;
    });
    assert.deepEqual(actual, await tamperSample(manifest, dek, items));
    assert.deepEqual(loaded, Array.from({ length: 3 }, (_, k) => items[(cursor + k) % 5].id));
  }
  manifest.tamperIdx = 0;
  items[1].photo[0] ^= 1;
  const damaged = await checkIndexedIntegrity(manifest, dek, metadata,
    async (record) => items.find((r) => r.id === record.id).photo);
  assert.equal(damaged.tampered, true);
  assert.equal(damaged.tamperIdx, 3);
});
