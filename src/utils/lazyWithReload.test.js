import { isChunkLoadError, reloadForNewBuild } from './lazyWithReload';

function memoryStorage() {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

test('recognises a stale build in every browser', () => {
  expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'Loading chunk 420 failed.' })).toBe(true);
  expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /static/js/1.js'))).toBe(true);
  expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
  expect(isChunkLoadError(new SyntaxError("Unexpected token '<'"))).toBe(true);
  expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
});

test('reloads once, not in a loop', () => {
  const storage = memoryStorage();
  const reload = jest.fn();
  expect(reloadForNewBuild(storage, reload, 1_000_000)).toBe(true);
  expect(reloadForNewBuild(storage, reload, 1_010_000)).toBe(false);
  expect(reloadForNewBuild(storage, reload, 1_070_001)).toBe(true);
  expect(reload).toHaveBeenCalledTimes(2);
});
