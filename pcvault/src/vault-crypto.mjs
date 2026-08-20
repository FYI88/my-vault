// vault-crypto.mjs — the PC vault's crypto core.
//
// PORTED FUNCTION-BY-FUNCTION from cyclev2.html's verified vault (feature 37 +
// Phase-6 hardening, security-reviewed and tested live): same constants, same
// key layering, same wipe discipline. Nothing here touches the DOM, IndexedDB,
// or the filesystem — it is a pure module that runs identically in Node (tests)
// and the Electron renderer (WebCrypto).
//
// Key layering ("double encryption"): every photo is encrypted under a fresh
// random 256-bit item key; the item key is wrapped by the DEK; the DEK is wrapped
// by the KEK derived from the passphrase AND by the KEK derived from the 12-word
// BIP-39 recovery seed. All keys are non-extractable CryptoKeys — WebCrypto
// refuses to hand the key material to any script. Plaintext and raw key bytes
// exist in memory only while needed and are zeroed the moment they are consumed.

import { BIP39_WORDS } from './bip39-words.mjs';

export const VAULT_ITERS = 600000; // PBKDF2 cost — deliberately steeper than a backup's 150k
export const VAULT_FILE_MAGIC = 'CVLT'; // first 4 bytes of a vault file
export const VAULT_FILE_VERSION = 1;

// ---- base64 helpers (small key material only — never used for photo bytes) ----
export function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
export function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function vaultRandId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function vaultWipeRaw(b) {
  // zero readable key/plaintext bytes so the material exists only inside its
  // sealed CryptoKey (or the immutable decoded copy the caller kept)
  try {
    if (b) (b instanceof ArrayBuffer ? new Uint8Array(b) : b).fill(0);
  } catch (e) { /* best-effort heap hygiene */ }
}

// ---- passphrase strength (0–4; gate at < 3, same as the phone vault) ----
export function vaultPassScore(pass) {
  if (!pass) return 0;
  let s = 0;
  if (pass.length >= 8) s++;
  if (pass.length >= 12) s++;
  const classes = [/[a-z]/.test(pass), /[A-Z]/.test(pass), /[0-9]/.test(pass), /[^a-zA-Z0-9]/.test(pass)].filter(Boolean).length;
  if (classes >= 2) s++;
  if (classes >= 3) s++;
  return s;
}

// ---- key derivation + wrapping (AES-256-GCM, fresh salt/IV per wrap) ----
async function deriveKey(input, saltBytes) {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(input), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: VAULT_ITERS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
export async function vaultWrap(kek, rawBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, rawBytes);
  return { iv: bufToB64(iv), data: bufToB64(data) };
}
export async function vaultUnwrap(kek, wrapper) {
  const iv = new Uint8Array(b64ToBuf(wrapper.iv));
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, kek, b64ToBuf(wrapper.data));
}
export function vaultImportAESKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ---- recovery seed (BIP-39, 12 words, checksummed) ----
export async function bip39FromEntropy(entropy) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy));
  const bits = [];
  for (const b of entropy) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  for (let i = 7; i >= 4; i--) bits.push((hash[0] >> i) & 1); // checksum = first 4 bits of the hash, MSB first
  const words = [];
  for (let i = 0; i < 12; i++) {
    let idx = 0;
    for (let j = 0; j < 11; j++) idx = (idx << 1) | bits[i * 11 + j];
    words.push(BIP39_WORDS[idx]);
  }
  return words.join(' ');
}
export async function bip39Generate() {
  const entropy = crypto.getRandomValues(new Uint8Array(16)); // 128 bits
  return bip39FromEntropy(entropy);
}
export async function bip39Validate(phrase) {
  const words = phrase.toLowerCase().trim().split(/\s+/);
  if (words.length !== 12) return null;
  const bits = [];
  for (const w of words) {
    const idx = BIP39_WORDS.indexOf(w);
    if (idx === -1) return null;
    for (let i = 10; i >= 0; i--) bits.push((idx >> i) & 1);
  }
  const entropy = new Uint8Array(16);
  for (let i = 0; i < 128; i++) if (bits[i]) entropy[i >> 3] |= 0x80 >> (i & 7);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy));
  const expect = hash[0] >> 4;
  let got = 0;
  for (let i = 0; i < 4; i++) got = (got << 1) | bits[128 + i];
  return got === expect ? entropy : null;
}

// ---- create / unlock ----
// createVault returns { manifest, dekRaw } — dekRaw is the one-time readable DEK;
// the caller must import it into a non-extractable CryptoKey and wipe it.
export async function createVault(pass, seedPhrase) {
  const saltP = crypto.getRandomValues(new Uint8Array(16));
  const saltS = crypto.getRandomValues(new Uint8Array(16));
  const kekP = await deriveKey(pass, saltP);
  const kekS = await deriveKey(seedPhrase, saltS);
  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const wrapP = await vaultWrap(kekP, dekRaw);
  const wrapS = await vaultWrap(kekS, dekRaw);
  const manifest = {
    v: 1,
    createdAt: Date.now(),
    iters: VAULT_ITERS,
    vaultId: vaultRandId(), // stamps every item this vault writes
    wrap: { salt: bufToB64(saltP), iv: wrapP.iv, data: wrapP.data },
    seedWrap: { salt: bufToB64(saltS), iv: wrapS.iv, data: wrapS.data },
    tamperIdx: 0, // deterministic tamper-sampling cursor
  };
  return { manifest, dekRaw };
}

// unlockWithPass / unlockWithSeed return the RAW DEK (ArrayBuffer) on success or
// null. The caller imports it via vaultImportAESKey and must wipe it in a finally.
export async function unlockWithPass(manifest, pass) {
  try {
    const kek = await deriveKey(pass, new Uint8Array(b64ToBuf(manifest.wrap.salt)));
    return await vaultUnwrap(kek, manifest.wrap);
  } catch (e) {
    return null;
  }
}
export async function unlockWithSeed(manifest, phrase) {
  const words = phrase.toLowerCase().trim().split(/\s+/);
  if (words.length !== 12) return null;
  const entropy = await bip39Validate(words.join(' '));
  if (!entropy) return null;
  try {
    const kek = await deriveKey(words.join(' '), new Uint8Array(b64ToBuf(manifest.seedWrap.salt)));
    return await vaultUnwrap(kek, manifest.seedWrap);
  } catch (e) {
    return null;
  }
}

// ---- security flows (re-wrap the same DEK, same gates as the phone vault) ----
// changePass re-wraps the DEK under a fresh-passphrase KEK with a fresh salt.
// It re-validates the 12-word seed first (checksum + real unwrap) as a safety
// gate — the seed keeps working afterwards, the old passphrase stops.
export async function changePass(manifest, current, newPass, seedPhrase) {
  let rawDek;
  try {
    const kekCur = await deriveKey(current, new Uint8Array(b64ToBuf(manifest.wrap.salt)));
    rawDek = await vaultUnwrap(kekCur, manifest.wrap);
  } catch (e) {
    return { ok: false, err: 'current passphrase is wrong' };
  }
  const words = seedPhrase.toLowerCase().trim().split(/\s+/);
  if (words.length !== 12) return { ok: false, err: 'enter all 12 words to confirm you can still get back in' };
  const entropy = await bip39Validate(words.join(' '));
  if (!entropy) return { ok: false, err: "those words don't look right. check the order and spelling." };
  try {
    const kekS = await deriveKey(words.join(' '), new Uint8Array(b64ToBuf(manifest.seedWrap.salt)));
    await vaultUnwrap(kekS, manifest.seedWrap);
  } catch (e) {
    return { ok: false, err: "those words don't unlock this vault" };
  }
  const saltNew = crypto.getRandomValues(new Uint8Array(16));
  const kekNew = await deriveKey(newPass, saltNew);
  const wrapNew = await vaultWrap(kekNew, rawDek);
  vaultWipeRaw(rawDek);
  manifest.wrap = { salt: bufToB64(saltNew), iv: wrapNew.iv, data: wrapNew.data };
  manifest.iters = VAULT_ITERS;
  return { ok: true, manifest };
}

// rotateSeed generates a fresh 12-word seed and re-wraps the DEK under it with a
// fresh salt. The OLD words die the moment the caller commits the returned
// manifest — nothing else changes (passphrase wrap untouched).
export async function rotateSeed(manifest, pass) {
  let rawDek;
  try {
    const kekCur = await deriveKey(pass, new Uint8Array(b64ToBuf(manifest.wrap.salt)));
    rawDek = await vaultUnwrap(kekCur, manifest.wrap);
  } catch (e) {
    return { ok: false, err: 'current passphrase is wrong' };
  }
  const phrase = await bip39Generate();
  const saltS = crypto.getRandomValues(new Uint8Array(16));
  const kekS = await deriveKey(phrase, saltS);
  const wrapS = await vaultWrap(kekS, rawDek);
  vaultWipeRaw(rawDek);
  manifest.seedWrap = { salt: bufToB64(saltS), iv: wrapS.iv, data: wrapS.data };
  return { ok: true, manifest, phrase };
}

// ---- items: per-item keys wrapped by the DEK (cryptographic delete) ----
// Every photo gets a fresh random 256-bit key; its bytes are encrypted under that
// key, and the key itself is wrapped under the DEK and stored with the record —
// deleting a record destroys its wrapped key with it.
export async function wrapItemKey(dek, itemKeyRaw) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, itemKeyRaw);
  return { iv: bufToB64(iv), key: bufToB64(data) };
}
export async function unwrapItemKey(dek, wrap) {
  const keyB64 = wrap.itemKey || wrap.key; // records store `itemKey` (phone schema); the wrap object uses `key`
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(wrap.iv)) },
    dek,
    b64ToBuf(keyB64)
  );
  try {
    return await vaultImportAESKey(raw);
  } finally {
    vaultWipeRaw(raw); // raw item key dies here — only the sealed CryptoKey remains
  }
}

// ---- content encryption ----
// Titles are small → base64 wrappers (same as the phone). Photo bytes are large →
// raw Uint8Array ciphertext that goes straight into the container file (no base64
// bloat). Plaintext buffers are zeroed right after decoding, best-effort.
export async function encText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { iv: bufToB64(iv), data: bufToB64(data) };
}
export async function decText(key, wrap) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(wrap.iv)) }, key, b64ToBuf(wrap.data));
  try {
    return new TextDecoder().decode(plain);
  } finally {
    vaultWipeRaw(plain);
  }
}
export async function encBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: bufToB64(iv), data: new Uint8Array(data) };
}
export async function decBytes(key, iv, cipherBytes) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(iv)) },
    key,
    cipherBytes
  );
  return new Uint8Array(plain);
}

// ---- tamper self-check on unlock ----
// Deterministic sample, exactly like the phone: sort owned records by immutable
// id, take the next slice of 3 from the persisted cursor, wrap around the list.
// Every record is guaranteed checked within ceil(N/3) unlocks. Any decrypt
// failure means bytes were modified → caller must lock + warn loudly.
// Returns { tampered, tamperIdx } with the NEW cursor for the caller to persist.
export async function tamperSample(manifest, dek, items) {
  if (!manifest || !dek || !items.length) return { tampered: false, tamperIdx: manifest.tamperIdx || 0 };
  const owned = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const idx = (manifest.tamperIdx || 0) % owned.length;
  const sample = [];
  for (let k = 0; k < 3 && sample.length < owned.length; k++) sample.push(owned[(idx + k) % owned.length]);
  const nextIdx = (idx + sample.length) % owned.length;
  for (const rec of sample) {
    try {
      const itemKey = await unwrapItemKey(dek, rec);
      // photos are checked on their actual bytes (same as the phone vault) — a
      // flipped byte anywhere in the ciphertext trips the check
      if (rec.kind === 'photo' && rec.photo) {
        const plain = await decBytes(itemKey, rec.photoIv, rec.photo);
        vaultWipeRaw(plain); // SEC-007 — zero the sampled plaintext, don't leave it to GC
      } else await decText(itemKey, { iv: rec.nameIv, data: rec.name });
    } catch (e) {
      return { tampered: true, tamperIdx: nextIdx };
    }
  }
  return { tampered: false, tamperIdx: nextIdx };
}
