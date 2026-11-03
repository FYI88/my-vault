import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyRecordInWorker } from '../src/integrity-client.mjs';

function workerMock(t) {
  const original = globalThis.Worker;
  const instances = [];
  class FakeWorker {
    constructor() { instances.push(this); this.messages = []; }
    postMessage(data, transfer) { this.messages.push({ data, transfer }); }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  t.after(() => { if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original; });
  return instances;
}

test('integrity client passes a sealed key, transfers chunks and terminates on completion', async (t) => {
  const workers = workerMock(t);
  const key = {};
  const record = { id: 'test', photoLen: 3 };
  const bytes = new Uint8Array([1, 2, 3]);
  const pending = verifyRecordInWorker(key, record, async () => bytes, () => true);
  const worker = workers[0];
  assert.equal(worker.messages[0].data.dek, key);
  await worker.onmessage({ data: { type: 'read', offset: 0, length: 3 } });
  assert.equal(worker.messages[1].transfer[0], bytes.buffer);
  await worker.onmessage({ data: { type: 'result', tampered: false } });
  assert.deepEqual(await pending, { tampered: false });
  assert.equal(worker.terminated, true);
});

test('locking aborts the worker and late reads cannot publish data', async (t) => {
  const workers = workerMock(t);
  const controller = new AbortController();
  let release;
  const pending = verifyRecordInWorker({}, { id: 'test' }, () => new Promise((resolve) => { release = resolve; }), () => true, controller.signal);
  const worker = workers[0];
  const read = worker.onmessage({ data: { type: 'read', offset: 0, length: 3 } });
  const rejected = assert.rejects(pending, /session ended/);
  controller.abort();
  release(new Uint8Array(3));
  await Promise.all([read, rejected]);
  assert.equal(worker.terminated, true);
  assert.equal(worker.messages.length, 1);
});

test('worker failure stays a rejected verification, never a successful unlock', async (t) => {
  const workers = workerMock(t);
  const pending = verifyRecordInWorker({}, {}, async () => new Uint8Array(), () => true);
  workers[0].onerror({ preventDefault() {} });
  await assert.rejects(pending, /worker failed/);
  assert.equal(workers[0].terminated, true);
});
