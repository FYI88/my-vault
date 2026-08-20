// container.mjs — the vault FILE format. The whole vault is ONE file:
//
//   'CVLT'           4-byte magic
//   u32 LE           format version (1)
//   u32 LE           header byte length
//   header JSON      the manifest (wrapped keys + salt + cursor) — UTF-8 bytes
//   records...       each: u32 LE json byte length + record JSON + raw bytes
//
// Each photo record's JSON carries { id, kind, createdAt, nameIv, name, iv,
// itemKey, photoIv, photoLen } — the AES-GCM ciphertext bytes follow the JSON
// raw (no base64 bloat). Titles stay base64 inside the JSON, exactly like the
// phone vault. At rest, nothing in the file is plaintext except the magic, the
// lengths, and the (encrypted) wrapped keys — no photo count metadata beyond
// the record structure itself.

import { VAULT_FILE_MAGIC, VAULT_FILE_VERSION } from './vault-crypto.mjs';

const te = new TextEncoder();
const td = new TextDecoder();

function concat(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
function u32le(n) {
  const b = new Uint8Array(4);
  b[0] = n & 0xff; b[1] = (n >> 8) & 0xff; b[2] = (n >> 16) & 0xff; b[3] = (n >>> 24) & 0xff;
  return b;
}
function readU32le(bytes, off) {
  return bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24);
}

// items: array of records; photo records carry `photo` (Uint8Array ciphertext).
export const MAX_RECORDS = 100000; // SEC-010 — a hostile .cvault with millions of tiny records must not spike CPU/RAM
export function serializeVault(manifest, items) {
  const headerBytes = te.encode(JSON.stringify(manifest));
  const parts = [
    te.encode(VAULT_FILE_MAGIC),
    u32le(VAULT_FILE_VERSION),
    u32le(headerBytes.length),
    headerBytes,
  ];
  for (const rec of items) {
    const { photo, ...json } = rec;
    const jsonBytes = te.encode(JSON.stringify(json));
    parts.push(u32le(jsonBytes.length));
    parts.push(jsonBytes);
    if (photo && photo.length) parts.push(photo);
  }
  return concat(...parts);
}

// Returns { manifest, items } or null when the file isn't a vault file.
export function parseVault(bytes) {
  try {
    const v = new Uint8Array(bytes);
    if (v.length < 12) return null;
    if (td.decode(v.subarray(0, 4)) !== VAULT_FILE_MAGIC) return null;
    if (readU32le(v, 4) !== VAULT_FILE_VERSION) return null;
    const headerLen = readU32le(v, 8);
    if (12 + headerLen > v.length) return null;
    const manifest = JSON.parse(td.decode(v.subarray(12, 12 + headerLen)));
    const items = [];
    let off = 12 + headerLen;
    while (off < v.length) {
      if (off + 4 > v.length) return null;
      const jsonLen = readU32le(v, off);
      off += 4;
      if (off + jsonLen > v.length) return null;
      const rec = JSON.parse(td.decode(v.subarray(off, off + jsonLen)));
      off += jsonLen;
      if (items.length >= MAX_RECORDS) return null; // SEC-010 — refuse instead of parsing forever
      if (rec.photoLen) {
        if (off + rec.photoLen > v.length) return null;
        rec.photo = v.slice(off, off + rec.photoLen);
        off += rec.photoLen;
      }
      items.push(rec);
    }
    return { manifest, items };
  } catch (e) {
    return null;
  }
}
