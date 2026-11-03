'use strict';

// CVLT v1 stays unchanged. Only metadata enters memory at open; payloads are
// read in bounded chunks and unchanged ciphertext is streamed when saving.
const fs = require('fs').promises;
const { randomUUID } = require('crypto');
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 100000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_INDEX_BYTES = 128 * 1024 * 1024;
const invalid = () => new Error('VAULT_INVALID: invalid or truncated vault');
const changed = () => new Error('VAULT_CHANGED: vault changed on disk; reopen it before continuing');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fingerprint = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };

async function readExactly(handle, length, position) {
  // A returned chunk must own its backing store. Small pooled Buffers would
  // otherwise transfer unrelated pool bytes along with the requested record.
  const bytes = Buffer.allocUnsafeSlow(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(bytes, offset, length - offset, position + offset);
    if (!result.bytesRead) throw invalid();
    offset += result.bytesRead;
  }
  return bytes;
}

async function writeAll(handle, bytes, position) {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.write(bytes, offset, bytes.length - offset, position + offset);
    if (!result.bytesWritten) throw new Error('vault write made no progress');
    offset += result.bytesWritten;
  }
  return position + offset;
}

function jsonBytes(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (!bytes.length || bytes.length > MAX_JSON_BYTES) throw invalid();
  return bytes;
}

function recordLength(record) {
  const length = record.photoLen === undefined ? 0 : record.photoLen;
  if (!isObject(record) || typeof record.id !== 'string' || !record.id ||
      !Number.isSafeInteger(length) || length < 0) throw invalid();
  return length;
}

async function checkFile(entry, handle) {
  const opened = await handle.stat({ bigint: true });
  const current = await fs.stat(entry.path, { bigint: true });
  if (fingerprint(opened) !== entry.fingerprint || fingerprint(current) !== entry.fingerprint) throw changed();
}

async function indexFile(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat({ bigint: true });
    const size = Number(stat.size);
    if (!Number.isSafeInteger(size) || size < 12 || !stat.isFile()) throw invalid();
    const prefix = await readExactly(handle, 12, 0);
    if (prefix.toString('ascii', 0, 4) !== 'CVLT' || prefix.readUInt32LE(4) !== 1) throw invalid();
    const headerLength = prefix.readUInt32LE(8);
    if (headerLength > MAX_JSON_BYTES || headerLength > size - 12) throw invalid();
    const manifest = JSON.parse((await readExactly(handle, headerLength, 12)).toString('utf8'));
    if (!isObject(manifest)) throw invalid();
    let offset = 12 + headerLength;
    let indexBytes = headerLength;
    const records = new Map();
    while (offset < size) {
      if (size - offset < 4 || records.size >= MAX_RECORDS) throw invalid();
      const length = (await readExactly(handle, 4, offset)).readUInt32LE();
      offset += 4;
      indexBytes += length;
      if (length > MAX_JSON_BYTES || indexBytes > MAX_INDEX_BYTES || length > size - offset) throw invalid();
      const metadata = JSON.parse((await readExactly(handle, length, offset)).toString('utf8'));
      // Payload bytes belong after the JSON, never inside attacker-controlled JSON.
      if (!isObject(metadata) || Object.hasOwn(metadata, 'photo')) throw invalid();
      const payloadLength = recordLength(metadata);
      offset += length;
      if (payloadLength > size - offset || records.has(metadata.id)) throw invalid();
      records.set(metadata.id, { metadata, offset, length: payloadLength });
      offset += payloadLength;
    }
    const entry = { path: filePath, manifest, records, size, fingerprint: fingerprint(stat) };
    await checkFile(entry, handle);
    return entry;
  } catch (error) {
    if (error instanceof SyntaxError) throw invalid();
    throw error;
  } finally { await handle.close(); }
}

function createVaultStore() {
  let active = null;
  let tail = Promise.resolve();
  const enqueue = (operation) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  function session(token) {
    if (!active || token !== active.token) throw new Error('invalid vault session');
    return active;
  }
  const describe = (entry) => ({ token: entry.token, manifest: entry.manifest,
    items: [...entry.records.values()].map((r) => r.metadata), byteLength: entry.size });

  return {
    open: (filePath) => enqueue(async () => {
      active = null;
      const entry = await indexFile(filePath);
      entry.token = randomUUID();
      active = entry;
      return describe(entry);
    }),
    path: (token) => session(token).path,
    read: (token, id, offset, length = CHUNK_BYTES) => enqueue(async () => {
      const entry = session(token);
      const record = entry.records.get(id);
      if (!record) throw new Error('unknown vault record');
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > record.length ||
          !Number.isSafeInteger(length) || length < 1 || length > CHUNK_BYTES) throw new Error('invalid payload range');
      const handle = await fs.open(entry.path, 'r');
      try {
        await checkFile(entry, handle);
        const bytes = await readExactly(handle, Math.min(length, record.length - offset), record.offset + offset);
        await checkFile(entry, handle);
        return bytes;
      } finally { await handle.close(); }
    }),
    save: (token, manifest, plan) => enqueue(async () => {
      const entry = session(token);
      if (!isObject(manifest) || !Array.isArray(plan) || plan.length > MAX_RECORDS) throw invalid();
      const header = jsonBytes(manifest);
      const next = new Map();
      let indexBytes = header.length;
      for (const part of plan) {
        if (!isObject(part) || !isObject(part.metadata)) throw invalid();
        const { metadata, photo } = part;
        if (Object.hasOwn(metadata, 'photo') || next.has(metadata.id)) throw invalid();
        const length = recordLength(metadata);
        const json = jsonBytes(metadata);
        indexBytes += json.length;
        if (indexBytes > MAX_INDEX_BYTES) throw invalid();
        const previous = entry.records.get(metadata.id);
        if (photo !== undefined) {
          if (!ArrayBuffer.isView(photo) || photo.BYTES_PER_ELEMENT !== 1 || photo.byteLength !== length) throw invalid();
        } else if (!previous || previous.length !== length) throw new Error('unknown or changed vault record');
        next.set(metadata.id, { metadata, json, photo, previous, length });
      }
      const tmp = `${entry.path}.tmp-${randomUUID()}`;
      const source = await fs.open(entry.path, 'r');
      let destination;
      let created = false;
      try {
        await checkFile(entry, source);
        destination = await fs.open(tmp, 'wx');
        created = true;
        // Reuse one buffer for the entire copy instead of creating/collecting
        // hundreds of multi-MB allocations on every manifest/content save.
        const copyBuffer = Buffer.allocUnsafe(CHUNK_BYTES);
        let position = await writeAll(destination, Buffer.concat([Buffer.from('CVLT'), u32(1), u32(header.length), header]), 0);
        for (const record of next.values()) {
          position = await writeAll(destination, u32(record.json.length), position);
          position = await writeAll(destination, record.json, position);
          record.offset = position;
          if (record.photo !== undefined) {
            const bytes = Buffer.from(record.photo.buffer, record.photo.byteOffset, record.photo.byteLength);
            position = await writeAll(destination, bytes, position);
          } else {
            for (let at = 0; at < record.length; at += CHUNK_BYTES) {
              const length = Math.min(CHUNK_BYTES, record.length - at);
              let read = 0;
              while (read < length) {
                const result = await source.read(copyBuffer, read, length - read, record.previous.offset + at + read);
                if (!result.bytesRead) throw invalid();
                read += result.bytesRead;
              }
              position = await writeAll(destination, copyBuffer.subarray(0, length), position);
            }
          }
        }
        await destination.sync();
        await checkFile(entry, source);
        await destination.close(); destination = null;
        await source.close();
        // Detect replacement of the path before committing our new snapshot.
        if (fingerprint(await fs.stat(entry.path, { bigint: true })) !== entry.fingerprint) throw changed();
        await fs.rename(tmp, entry.path);
        const stat = await fs.stat(entry.path, { bigint: true });
        entry.manifest = manifest;
        entry.size = position;
        entry.fingerprint = fingerprint(stat);
        entry.records = new Map([...next].map(([id, r]) => [id, { metadata: r.metadata, offset: r.offset, length: r.length }]));
        return { byteLength: position };
      } catch (error) {
        if (destination) await destination.close().catch(() => {});
        await source.close().catch(() => {});
        if (created) await fs.unlink(tmp).catch(() => {});
        throw error;
      }
    }),
  };
}

module.exports = { createVaultStore, CHUNK_BYTES };
