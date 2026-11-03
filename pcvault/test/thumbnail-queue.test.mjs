import assert from 'node:assert/strict';
import test from 'node:test';
import { createThumbnailQueue } from '../src/thumbnail-queue.mjs';

test('thumbnail concurrency is bounded across a burst of visible cells', async () => {
  const run = createThumbnailQueue(2);
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 30 }, () => run(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
  }, () => true));
  await Promise.all(tasks);
  assert.equal(peak, 2);
});

test('queued work from an expired session is never started', async () => {
  const run = createThumbnailQueue(1);
  let release;
  let valid = true;
  let started = false;
  const first = run(() => new Promise((resolve) => { release = resolve; }), () => true);
  const pending = run(() => { started = true; }, () => valid);
  await Promise.resolve();
  valid = false;
  const rejected = assert.rejects(pending, /session ended/);
  release();
  await Promise.all([first, rejected]);
  assert.equal(started, false);
});
