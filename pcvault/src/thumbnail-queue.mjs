// Grid observers and the gallery share this budget; scrolling must not start
// dozens of full-video decrypts at once. Check session validity when dequeued.
export function createThumbnailQueue(limit = 2) {
  let active = 0;
  const waiting = [];
  function drain() {
    while (active < limit && waiting.length) {
      const { work, valid, resolve, reject } = waiting.shift();
      if (!valid()) { reject(new Error('session ended')); continue; }
      active++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; drain(); });
    }
  }
  return (work, valid) => new Promise((resolve, reject) => {
    waiting.push({ work, valid, resolve, reject });
    drain();
  });
}
