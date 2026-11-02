// Keep complete encrypted snapshots in request order. A failed write must not
// block later saves, but its caller still needs to receive the failure.
export function createSaveWriter(write, onError = () => {}) {
  let tail = Promise.resolve();
  return function save(path, bytes) {
    const result = tail.then(() => write(path, bytes));
    tail = result.catch((error) => { onError(error); });
    return result;
  };
}
