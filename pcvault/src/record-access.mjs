import { tamperSample } from './vault-crypto.mjs';

const CHUNK_BYTES = 4 * 1024 * 1024;
const ended = () => new Error('vault session ended');

export async function readRecordBytes(record, readChunk, valid = () => true) {
  if (!valid()) throw ended();
  const length = record.photoLen || 0;
  if (!Number.isSafeInteger(length) || length < 0 || length > 2 ** 31 - 1) throw new Error('invalid record length');
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += CHUNK_BYTES) {
    if (!valid()) throw ended();
    const size = Math.min(CHUNK_BYTES, length - offset);
    const chunk = await readChunk(offset, size);
    if (!valid()) throw ended();
    if (!(chunk instanceof Uint8Array) || chunk.length !== size) throw new Error('truncated record read');
    bytes.set(chunk, offset);
  }
  return bytes;
}

// Same sorted round-robin sample and cursor as tamperSample. Invoke the existing
// checker one record at a time so only ONE sampled ciphertext is resident.
// Encryption and verification of both full payload and name remain unchanged.
export async function checkIndexedIntegrity(manifest, dek, items, readPayload, valid = () => true, verifyRecord) {
  if (!items.length) return tamperSample(manifest, dek, items);
  const owned = [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const start = (manifest.tamperIdx || 0) % owned.length;
  const count = Math.min(3, owned.length);
  const tamperIdx = (start + count) % owned.length;
  for (let k = 0; k < count; k++) {
    if (!valid()) throw ended();
    const record = owned[(start + k) % owned.length];
    let result;
    if (verifyRecord) result = await verifyRecord(record);
    else {
      const photo = await readPayload(record);
      if (!valid()) throw ended();
      result = await tamperSample({ ...manifest, tamperIdx: 0 }, dek, [{ ...record, photo }]);
    }
    if (!valid()) throw ended();
    if (result.tampered) return { tampered: true, tamperIdx };
  }
  return { tampered: false, tamperIdx };
}
