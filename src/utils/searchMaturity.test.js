import { supabase } from './supabase';
import { allowedForProfile, filterSearchPayload, resetSearchMaturityCache } from './searchMaturity';

jest.mock('./supabase', () => {
  const ratings = { movies: { 1: 'R', 2: 'PG', 3: null, 4: 'PG-13' }, tv_shows: { 10: 'TV-MA', 11: 'TV-Y7' } };
  // A plain function (CRA resets jest.fn implementations before each test).
  const calls = { count: 0 };
  const from = (table) => {
    calls.count += 1;
    return {
    select: () => ({
      in: (_column, ids) => Promise.resolve({
        data: ids.map((id) => ({ id, age_rating: ratings[table][id] ?? null })),
        error: table === 'broken' ? new Error('down') : null,
      }),
    }),
    };
  };
  return { isSupabaseConfigured: true, supabase: { from, calls } };
});

beforeEach(() => { resetSearchMaturityCache(); supabase.calls.count = 0; });

test('no restriction leaves results alone', async () => {
  const items = [{ id: 1 }, { id: 2 }];
  expect(await allowedForProfile(items, 'movie', false)).toBe(items);
});

test('a Kids profile only finds titles rated for kids', async () => {
  const movies = await allowedForProfile([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], 'movie', 'kids');
  expect(movies.map((item) => item.id)).toEqual([2]);
  const shows = await allowedForProfile([{ id: 10 }, { id: 11 }], 'tv', 'kids');
  expect(shows.map((item) => item.id)).toEqual([11]);
});

test('Teens also find PG-13', async () => {
  const movies = await allowedForProfile([{ id: 1 }, { id: 2 }, { id: 4 }], 'movie', 'teens');
  expect(movies.map((item) => item.id)).toEqual([2, 4]);
});

test('ratings are looked up once', async () => {
  await allowedForProfile([{ id: 1 }, { id: 2 }], 'movie', 'kids');
  await allowedForProfile([{ id: 2 }], 'movie', 'kids');
  expect(supabase.calls.count).toBe(1);
});

test('child levels keep children\'s books only', async () => {
  const books = [{ id: 1, genre: "Children's, Fantasy" }, { id: 2, genre: 'Thriller' }, { id: 3, genre: 'Middle Grade' }];
  expect((await allowedForProfile(books, 'book', 'kids')).map((b) => b.id)).toEqual([1, 3]);
  expect((await allowedForProfile(books, 'book', 'teens')).map((b) => b.id)).toEqual([1, 2, 3]);
});

test('every section of a payload is filtered', async () => {
  const payload = { movies: [{ id: 1 }, { id: 2 }], tv: [{ id: 10 }], books: [], moviesRelated: [{ id: 4 }], people: ['x'] };
  const next = await filterSearchPayload(payload, 'kids');
  expect(next.movies.map((item) => item.id)).toEqual([2]);
  expect(next.tv).toEqual([]);
  expect(next.moviesRelated).toEqual([]);
  expect(next.people).toEqual(['x']);
});
