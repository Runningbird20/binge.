let mockTables = {};

// A tiny stand-in for the Supabase query builder: honours eq/in filters and
// range paging, which is all fetchWatchedTitleKeys uses.
jest.mock('./supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
  get supabase() {
    return {
      from: (table) => {
        const filters = [];
        const builder = {
          select: () => builder,
          eq: (column, value) => { filters.push((row) => row[column] === value); return builder; },
          in: (column, values) => { filters.push((row) => values.includes(row[column])); return builder; },
          order: () => builder,
          range: (from, to) => {
            const source = mockTables[table];
            if (source instanceof Error) return Promise.resolve({ data: null, error: source });
            const rows = (source || []).filter((row) => filters.every((keep) => keep(row)));
            return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
          },
        };
        return builder;
      },
    };
  },
}));

import * as supabaseData from './supabaseData';
import { loadWatchedKeys, resetWatchedKeys, titleKey, withoutWatched } from './watchedTitles';

afterEach(() => {
  jest.restoreAllMocks();
  resetWatchedKeys();
});

test('watched = rated, marked Watched/Watching, in Continue Watching, or any episode watched', async () => {
  const episodes = Array.from({ length: 1500 }, (_, index) => ({ id: index, user_id: 'u1', media_id: index < 1499 ? 20 : 21 }));
  mockTables = {
    movie_ratings: [{ id: 1, user_id: 'u1', media_id: 5 }, { id: 2, user_id: 'someone-else', media_id: 6 }],
    tv_show_ratings: new Error('offline'), // one table failing doesn't lose the rest
    watchlist: [
      { id: 1, user_id: 'u1', media_type: 'movie', media_id: 7, status: 'watched' },
      { id: 2, user_id: 'u1', media_type: 'tv_show', media_id: 12, status: 'watching' },
      { id: 3, user_id: 'u1', media_type: 'movie', media_id: 8, status: 'plan_to_watch' },
      { id: 4, user_id: 'u1', media_type: 'book', media_id: 9, status: 'watched' },
    ],
    continue_watching: [
      { id: 1, user_id: 'u1', media_type: 'tv_show', media_id: 11 },
      { id: 2, user_id: 'u1', media_type: 'book', media_id: 30 },
    ],
    episode_progress: episodes, // more than one 1000-row page
  };
  const keys = await supabaseData.fetchWatchedTitleKeys();
  expect([...keys].sort()).toEqual(['movie:5', 'movie:7', 'tv_show:11', 'tv_show:12', 'tv_show:20', 'tv_show:21']);
});

test('withoutWatched drops watched titles whatever id field the item uses', () => {
  const keys = new Set(['movie:5', 'tv_show:11']);
  const items = [
    { media_type: 'movie', id: 5 },
    { media_type: 'movie', id: '6' },
    { media_type: 'tv_show', media_id: 11, id: 99 },
    { media_type: 'tv_show', id: 5 },
  ];
  expect(withoutWatched(items, keys)).toEqual([{ media_type: 'movie', id: '6' }, { media_type: 'tv_show', id: 5 }]);
  expect(withoutWatched(items, new Set())).toBe(items);
  expect(withoutWatched(items, null)).toBe(items);
  expect(titleKey({ media_type: 'movie', id: '5' })).toBe('movie:5');
});

test('one request is shared and reused; a history change loads again', async () => {
  const fetch = jest.spyOn(supabaseData, 'fetchWatchedTitleKeys')
    .mockResolvedValueOnce(new Set(['movie:1']))
    .mockResolvedValueOnce(new Set(['movie:1', 'movie:2']));
  const [first, second] = await Promise.all([loadWatchedKeys(), loadWatchedKeys()]);
  expect(first).toBe(second);
  expect(await loadWatchedKeys()).toBe(first);
  expect(fetch).toHaveBeenCalledTimes(1);

  window.dispatchEvent(new CustomEvent('binge:historyChanged'));
  expect([...(await loadWatchedKeys())]).toEqual(['movie:1', 'movie:2']);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('signed out or failing: nothing counts as watched', async () => {
  jest.spyOn(supabaseData, 'fetchWatchedTitleKeys').mockRejectedValue(new Error('no session'));
  expect((await loadWatchedKeys()).size).toBe(0);
});
