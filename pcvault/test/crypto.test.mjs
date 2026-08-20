// crypto.test.mjs — proves the PC vault's crypto core (ported from the verified
// phone vault) is faithful: create → unlock (pass + seed) → item round-trip →
// tamper detection → change passphrase → rotate seed. Runs in plain Node 24
// (globalThis.crypto = WebCrypto). No DOM, no filesystem.
import assert from 'node:assert/strict';
import {
  createVault, unlockWithPass, unlockWithSeed,
  changePass, rotateSeed,
  wrapItemKey, unwrapItemKey, encText, decText, encBytes, decBytes,
  tamperSample, vaultImportAESKey, vaultPassScore, bip39Validate,
  VAULT_ITERS,
} from '../src/vault-crypto.mjs';

const pass = 'purple-cactus-9!'; // the exact passphrase the phone vault's tests used
// a VALID BIP-39 seed (checksummed) — hand-picked words are rejected by design
const seed = 'fetch wet lady exhibit range sight mule muffin silk change light soldier';

let passTests = 0, failTests = 0;
async function t(name, fn) {
  passTests++;
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failTests++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}
function flipB64(b64) {
  const bytes = new Uint8Array(atob(b64));
  bytes[2] ^= 0x01;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

let manifest, dekRaw;

await t('createVault builds a correct manifest', async () => {
  const r = await createVault(pass, seed);
  manifest = r.manifest; dekRaw = r.dekRaw;
  assert.equal(manifest.v, 1);
  assert.equal(manifest.iters, VAULT_ITERS);
  assert.ok(manifest.vaultId && manifest.vaultId.length === 16);
  assert.ok(manifest.wrap.salt && manifest.wrap.iv && manifest.wrap.data);
  assert.ok(manifest.seedWrap.salt && manifest.seedWrap.iv && manifest.seedWrap.data);
  assert.equal(dekRaw.byteLength, 32);
});
await t('passphrase unlocks and yields a usable 32-byte DEK', async () => {
  const raw = await unlockWithPass(manifest, pass);
  assert.ok(raw);
  assert.equal(raw.byteLength, 32);
});
await t('wrong passphrase returns null', async () => {
  assert.equal(await unlockWithPass(manifest, 'wrong-wrong-wrong!'), null);
});
await t('seed unlocks', async () => {
  const raw = await unlockWithSeed(manifest, seed);
  assert.ok(raw);
  assert.equal(raw.byteLength, 32);
});
await t('tampered seed rejected (checksum)', async () => {
  // all-valid words, correct count, but the checksum can't match: deterministic
  assert.equal(await bip39Validate('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'), null);
});
await t('unknown word rejected', async () => {
  assert.equal(await bip39Validate('fetch wet lady exhibit range sight mule muffin silk change light notaword'), null);
});
await t('11-word seed rejected', async () => {
  assert.equal(await bip39Validate('fetch wet lady exhibit range sight mule muffin silk change light'), null);
});

// ---- 2. item round-trip (photo: name cipher + blob cipher, both under item key) ----
// Record schema matches the phone vault exactly: `iv`/`itemKey` = key wrap,
// `nameIv`/`name` = the filename cipher, `photoIv`/`photo` = the photo cipher.
const dek = await vaultImportAESKey(dekRaw); dekRaw.fill(0); // simulate the caller's import + wipe
const itemKeyRaw = crypto.getRandomValues(new Uint8Array(32));
const itemKey = await vaultImportAESKey(itemKeyRaw);
const keyWrap = await wrapItemKey(dek, itemKeyRaw);
itemKeyRaw.fill(0); // wipe the raw item key after wrapping, like the app
let rec = { id: 'abc123', kind: 'photo', createdAt: Date.now() };
await t('item key unwraps under the DEK and decrypts the name', async () => {
  const nameEnc = await encText(itemKey, 'me and you.jpg');
  rec.iv = keyWrap.iv; rec.itemKey = keyWrap.key; // key wrap goes on the record
  rec.nameIv = nameEnc.iv; rec.name = nameEnc.data;
  const k = await unwrapItemKey(dek, rec);
  assert.equal(await decText(k, { iv: rec.nameIv, data: rec.name }), 'me and you.jpg');
});
await t('photo bytes round-trip through encBytes/decBytes', async () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const enc = await encBytes(itemKey, fakeJpeg);
  rec.photoIv = enc.iv; rec.photo = enc.data; // raw ciphertext bytes, straight to the container
  const k = await unwrapItemKey(dek, rec);
  const plain = await decBytes(k, enc.iv, enc.data);
  assert.deepEqual([...plain], [...fakeJpeg]);
});
await t('ciphertext is not the plaintext (it is actually encrypted)', () => {
  assert.notDeepEqual([...rec.photo], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

// ---- 3. tamper self-check ----
await t('intact vault passes the tamper sample', async () => {
  const r = await tamperSample(manifest, dek, [rec]);
  assert.equal(r.tampered, false);
  manifest.tamperIdx = r.tamperIdx;
});
await t('flipped byte in the name ciphertext → tampered, nothing shown', async () => {
  const rec2 = { ...rec, kind: 'note', name: flipB64(rec.name) }; // notes are checked on their name cipher
  const r = await tamperSample(manifest, dek, [rec2]);
  assert.equal(r.tampered, true);
});
await t('flipped byte in the photo ciphertext → tampered', async () => {
  const rec2 = { ...rec, photo: new Uint8Array([...rec.photo.slice(0, 4), rec.photo[4] ^ 0x01, ...rec.photo.slice(5)]) };
  const r = await tamperSample(manifest, dek, [rec2]);
  assert.equal(r.tampered, true);
});
await t('deterministic cursor advances across unlocks (round-robin coverage)', async () => {
  const items = [];
  for (let i = 0; i < 7; i++) {
    const kRaw = crypto.getRandomValues(new Uint8Array(32));
    const k = await vaultImportAESKey(kRaw);
    const kw = await wrapItemKey(dek, kRaw);
    kRaw.fill(0);
    const nameEnc = await encText(k, 'photo ' + i);
    items.push({ id: 'id' + String(i).padStart(3, '0'), kind: 'note', iv: kw.iv, itemKey: kw.key, nameIv: nameEnc.iv, name: nameEnc.data });
  }
  const m = { ...manifest, tamperIdx: 0 };
  for (let u = 0; u < 4; u++) {
    const r = await tamperSample(m, dek, items);
    assert.equal(r.tampered, false);
    m.tamperIdx = r.tamperIdx;
  }
  assert.equal(m.tamperIdx, 12 % 7); // 3*4=12 samples, wrapped at 7
});

// ---- 4. change passphrase ----
await t('changePass refuses a wrong current passphrase', async () => {
  const r = await changePass({ ...manifest }, 'nope-nope-nope', 'new-pass-123!', seed);
  assert.equal(r.ok, false);
});
await t('changePass re-wraps under a new KEK; old pass dies, seed still works', async () => {
  const r = await changePass(manifest, pass, 'brand-new-pass-456!', seed);
  assert.ok(r.ok);
  manifest = r.manifest;
  assert.equal(await unlockWithPass(manifest, pass), null);            // old passphrase dead
  assert.ok(await unlockWithPass(manifest, 'brand-new-pass-456!'));    // new passphrase works
  assert.ok(await unlockWithSeed(manifest, seed));                     // seed untouched
});

// ---- 5. rotate seed ----
await t('rotateSeed kills the old words; new words unlock', async () => {
  const r = await rotateSeed(manifest, 'brand-new-pass-456!');
  assert.ok(r.ok);
  assert.ok(r.phrase.split(' ').length === 12);
  assert.equal(await unlockWithSeed(manifest, seed), null);   // old words dead
  assert.ok(await unlockWithSeed(manifest, r.phrase));        // new words work
  assert.ok(await unlockWithPass(manifest, 'brand-new-pass-456!')); // passphrase untouched
  manifest = r.manifest;
});

// ---- 6. strength gate sanity (same expectations as the phone vault) ----
await t('passphrase strength: password=1, password1=2, purple-cactus-9!=4', () => {
  assert.equal(vaultPassScore('password'), 1);
  assert.equal(vaultPassScore('password1'), 2);
  assert.equal(vaultPassScore('purple-cactus-9!'), 4);
});

console.log(`\n${passTests - failTests}/${passTests} passed`);
process.exit(failTests ? 1 : 0);
