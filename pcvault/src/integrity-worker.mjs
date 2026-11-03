// Short-lived worker: the complete sampled record and WebCrypto's temporary
// plaintext buffers never occupy the UI isolate. Terminated after each record.
import { readRecordBytes } from './record-access.mjs';
import { tamperSample } from './vault-crypto.mjs';

let pendingChunk;
self.onmessage = async ({ data }) => {
  if (data.type === 'chunk') { pendingChunk.resolve(data.bytes); return; }
  if (data.type === 'chunk-error') { pendingChunk.reject(new Error('record read failed')); return; }
  if (data.type !== 'verify') return;
  try {
    const photo = data.record.photo ?? await readRecordBytes(data.record, (offset, length) => new Promise((resolve, reject) => {
      pendingChunk = { resolve, reject };
      self.postMessage({ type: 'read', offset, length });
    }));
    const result = await tamperSample({ tamperIdx: 0 }, data.dek, [{ ...data.record, photo }]);
    self.postMessage({ type: 'result', tampered: result.tampered });
  } catch {
    self.postMessage({ type: 'error' });
  }
};
