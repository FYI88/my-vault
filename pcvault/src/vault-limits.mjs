export const MAX_VAULT_BYTES = Math.floor(1.9 * 1024 ** 3);
export const WARN_VAULT_BYTES = Math.floor(1.7 * 1024 ** 3);
export const READ_FILE_LIMIT = 2 ** 31 - 1;
const encoder = new TextEncoder();

// Count the serialized size without allocating a second vault-sized buffer.
export function vaultByteLength(manifest, items) {
  let size = 12 + encoder.encode(JSON.stringify(manifest)).length;
  for (const record of items) {
    const { photo, ...metadata } = record;
    size += 4 + encoder.encode(JSON.stringify(metadata)).length + (photo?.length ?? metadata.photoLen ?? 0);
  }
  return size;
}

// Preflight is conservative; the encrypted record is checked exactly afterward.
export function importFits(currentBytes, fileBytes, name = '') {
  return Number.isSafeInteger(fileBytes) && fileBytes >= 0 &&
    currentBytes + fileBytes + encoder.encode(name).length * 4 + 4096 <= MAX_VAULT_BYTES;
}
