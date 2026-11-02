import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaveWriter } from '../src/save-writer.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('newer saves cannot finish before an older write', async () => {
  const firstWrite = deferred();
  const started = [];
  let disk;
  const save = createSaveWriter(async (path, bytes) => {
    started.push(bytes);
    if (bytes === 'old') await firstWrite.promise;
    disk = bytes;
  });
  const first = save('vault', 'old');
  const second = save('vault', 'new');
  await Promise.resolve();
  assert.deepEqual(started, ['old']);
  firstWrite.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(started, ['old', 'new']);
  assert.equal(disk, 'new');
});

test('each caller waits for its own snapshot to reach disk', async () => {
  const gate = deferred();
  let finished = false;
  const save = createSaveWriter(() => gate.promise);
  const result = save('vault', 'data').then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  gate.resolve();
  await result;
  assert.equal(finished, true);
});

test('a failed write is reported and rejects its caller without blocking later saves', async () => {
  const failure = new Error('disk full');
  const errors = [];
  const written = [];
  const save = createSaveWriter(async (path, bytes) => {
    if (bytes === 'first') throw failure;
    written.push(bytes);
  }, (error) => errors.push(error));
  const first = save('vault', 'first');
  const second = save('vault', 'retry');
  await assert.rejects(first, (error) => error === failure);
  await second;
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(written, ['retry']);
});

test('queued snapshots retain their own destination and bytes', async () => {
  const gate = deferred();
  const written = [];
  const save = createSaveWriter(async (path, bytes) => {
    if (!written.length) await gate.promise;
    written.push([path, [...bytes]]);
  });
  const first = save('first.cvault', new Uint8Array([1]));
  const second = save('second.cvault', new Uint8Array([2]));
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(written, [['first.cvault', [1]], ['second.cvault', [2]]]);
});
