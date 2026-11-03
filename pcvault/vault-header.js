'use strict';

const fs = require('fs');
const { pipeline } = require('stream/promises');
const { randomUUID } = require('crypto');

// Replace only the manifest in an atomic streamed copy. Payload bytes remain
// unchanged on disk; none cross IPC or enter a whole-vault memory buffer.
async function writeManifestAtomic(filePath, manifest) {
  const header = Buffer.from(JSON.stringify(manifest));
  const source = await fs.promises.open(filePath, 'r');
  const tmp = `${filePath}.tmp-${randomUUID()}`;
  try {
    const prefix = Buffer.alloc(12);
    const { bytesRead } = await source.read(prefix, 0, 12, 0);
    const size = (await source.stat()).size;
    if (bytesRead !== 12 || prefix.toString('ascii', 0, 4) !== 'CVLT' || prefix.readUInt32LE(4) !== 1) {
      throw new Error('invalid vault header');
    }
    const payloadStart = 12 + prefix.readUInt32LE(8);
    if (payloadStart > size) throw new Error('truncated vault header');
    prefix.writeUInt32LE(header.length, 8);
    await fs.promises.writeFile(tmp, Buffer.concat([prefix, header]), { flag: 'wx' });
    if (payloadStart < size) {
      await pipeline(
        source.createReadStream({ start: payloadStart, autoClose: false, highWaterMark: 256 * 1024 }),
        fs.createWriteStream(tmp, { flags: 'a', highWaterMark: 256 * 1024 }),
      );
    }
    await source.close();
    await fs.promises.rename(tmp, filePath);
  } catch (error) {
    await source.close().catch(() => {});
    await fs.promises.unlink(tmp).catch(() => {});
    throw error;
  }
}

module.exports = { writeManifestAtomic };
