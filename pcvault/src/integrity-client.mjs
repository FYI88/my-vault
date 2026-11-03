// CryptoKeys are structured-cloned without exporting them. Only bounded,
// already-encrypted chunks pass through the UI, then transfer to the worker.
export function verifyRecordInWorker(dek, record, readChunk, valid, signal) {
  if (!valid() || signal?.aborted) return Promise.reject(new Error('vault session ended'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./integrity-worker.mjs', import.meta.url), { type: 'module' });
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new Error('vault session ended'));
    const timeout = setTimeout(() => finish(new Error('integrity check timed out')), 60000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { event.preventDefault(); finish(new Error('integrity worker failed')); };
    worker.onmessageerror = () => finish(new Error('integrity worker message failed'));
    worker.onmessage = async ({ data }) => {
      if (done) return;
      if (!valid()) { abort(); return; }
      if (data.type === 'result') { finish(null, { tampered: data.tampered }); return; }
      if (data.type === 'error') { finish(new Error('integrity record read failed')); return; }
      if (data.type !== 'read') return;
      try {
        const chunk = await readChunk(data.offset, data.length);
        if (done) return;
        if (!valid()) { abort(); return; }
        worker.postMessage({ type: 'chunk', bytes: chunk }, [chunk.buffer]);
      } catch (error) { finish(error); }
    };
    try { worker.postMessage({ type: 'verify', dek, record }); }
    catch (error) { finish(error); }
  });
}
