import { fetchRandomIdWindow } from './catalogQueries';

// A query stub over sorted ids, supporting what fetchRandomIdWindow uses.
function queryOver(ids) {
  return () => {
    let rows = [...ids];
    const q = {
      gte: (col, v) => { rows = rows.filter((id) => id >= v); return q; },
      lt: (col, v) => { rows = rows.filter((id) => id < v); return q; },
      order: () => q,
      limit: (n) => Promise.resolve({ data: rows.slice(0, n).map((id) => ({ id })), error: null }),
    };
    return q;
  };
}

afterEach(() => jest.restoreAllMocks());

test('takes the rows after a random id', async () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  const rows = await fetchRandomIdWindow(queryOver([10, 20, 55, 60, 70, 90]), { idSpace: 100, limit: 2 });
  expect(rows.map((r) => r.id)).toEqual([55, 60]);
});

test('wraps to the start when the stretch after the id runs short', async () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.85);
  const rows = await fetchRandomIdWindow(queryOver([10, 20, 55, 60, 70, 90]), { idSpace: 100, limit: 3 });
  expect(rows.map((r) => r.id)).toEqual([90, 10, 20]);
});

test('passes query errors through', async () => {
  const failing = () => {
    const q = { gte: () => q, lt: () => q, order: () => q, limit: () => Promise.resolve({ data: null, error: new Error('down') }) };
    return q;
  };
  await expect(fetchRandomIdWindow(failing, { idSpace: 100, limit: 3 })).rejects.toThrow('down');
});
