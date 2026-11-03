import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_VAULT_BYTES, READ_FILE_LIMIT, importFits, vaultByteLength } from '../src/vault-limits.mjs';
import { serializeVault } from '../src/container.mjs';

test('size counter agrees with the existing file serializer', () => {
  const manifest = { prefs: {}, tamperIdx: 1 };
  const items = [{ id: 'unicode-é', photoLen: 32, photo: new Uint8Array(32) }];
  assert.equal(vaultByteLength(manifest, items), serializeVault(manifest, items).length);
});

test('imports reserve metadata space below the hard reader ceiling', () => {
  assert(MAX_VAULT_BYTES < READ_FILE_LIMIT);
  assert(importFits(100, 200, 'small.txt'));
  assert.equal(importFits(MAX_VAULT_BYTES - 1000, 1000, 'video.mp4'), false);
  assert.equal(importFits(0, READ_FILE_LIMIT, 'too-large'), false);
  assert.equal(importFits(0, -1), false);
  assert.equal(importFits(0, NaN), false);
});

test('size counter includes ciphertext that is stored lazily on disk', () => {
  const manifest = { tamperIdx: 0 };
  const full = [{ id: 'doc', photoLen: 1024, photo: new Uint8Array(1024) }];
  const lazy = full.map(({ photo, ...metadata }) => metadata);
  assert.equal(vaultByteLength(manifest, lazy), serializeVault(manifest, full).length);
});
