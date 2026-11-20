import { createCollectionFeed, fillParams, visibleCollections } from './collections';
import data from '../../public/collections.json';

const tmdb = (id, date, extra = {}) => ({ id, title: `T${id}`, release_date: date, ...extra });

// The catalog stand-in: every id matches except those in `missing`.
const fakeResolve = (missing = new Set()) => async (results, mediaType) => results
  .filter((r) => !missing.has(r.tmdbId))
  .map((r) => ({ id: r.tmdbId * 10, title: r.title, media_type: mediaType, _tmdb: r }));

test('date tokens become the local date, moved by days', () => {
  const today = new Date(2026, 10, 19);
  expect(fillParams({ 'primary_release_date.lte': '{today+30}', a: '{today}', b: '{today-365}', c: 'x' }, today))
    .toEqual({ 'primary_release_date.lte': '2026-12-19', a: '2026-11-19', b: '2025-11-19', c: 'x' });
});

test('every collection in the list is well formed and its group exists', () => {
  const groups = new Set(data.groups.map((g) => g.id));
  const ids = new Set();
  for (const c of data.collections) {
    expect(groups.has(c.group)).toBe(true);
    expect(ids.has(c.id)).toBe(false);
    ids.add(c.id);
    expect(c.title && c.subtitle && c.sources.length).toBeTruthy();
    for (const s of c.sources) expect(['discover', 'list', 'collection', 'titles', 'person']).toContain(s.type);
  }
  expect(data.collections.length).toBeGreaterThan(100);
  expect(data.collections.filter((c) => c.group === 'malayalam').length).toBeGreaterThan(10);
});

test('restricted profiles lose the mature sets, and empty groups with them', () => {
  const all = visibleCollections(data);
  const kids = visibleCollections(data, { kidsSafe: 'kids' });
  expect(kids.collections.length).toBeLessThan(all.collections.length);
  expect(kids.collections.some((c) => c.id === 'saw')).toBe(false);
  expect(kids.collections.some((c) => c.id === 'toy-story')).toBe(true);
  expect(kids.groups.every((g) => g.collections.length)).toBe(true);
});

test('a franchise comes in release order across its TMDB collections', async () => {
  const get = async (path) => ({
    '/collection/1': { parts: [tmdb(3, '2010-01-01'), tmdb(1, '2001-01-01')] },
    '/collection/2': { parts: [tmdb(2, '2005-01-01')] },
  }[path]);
  const feed = createCollectionFeed({ id: 'f', order: 'release', sources: [{ type: 'collection', media: 'movie', ids: [1, 2] }] }, { get, resolve: fakeResolve() });
  expect((await feed.next()).map((i) => i.title)).toEqual(['T1', 'T2', 'T3']);
  expect(feed.done).toBe(true);
});

test('pages keep coming until the source runs out, skipping pages with nothing on binge.', async () => {
  const pages = { 1: [tmdb(1), tmdb(2)], 2: [tmdb(3)], 3: [tmdb(4), tmdb(1)] };
  const get = async (path, params) => ({ results: pages[params.page], total_pages: 3 });
  const feed = createCollectionFeed({ id: 'd', sources: [{ type: 'discover', media: 'movie', params: {} }] }, { get, resolve: fakeResolve(new Set([3])) });
  expect((await feed.next()).map((i) => i.title)).toEqual(['T1', 'T2']);
  // Page 2 has only a title the catalog lacks: the same call reads on to page 3,
  // and T1 isn't shown twice.
  expect((await feed.next()).map((i) => i.title)).toEqual(['T4']);
  expect(feed.done).toBe(true);
});

test('a limit stops the set (All-time top 100)', async () => {
  const get = async (path, params) => ({ results: Array.from({ length: 20 }, (_, i) => tmdb(Number(params.page) * 100 + i)), total_pages: 50 });
  const feed = createCollectionFeed({ id: 't', limit: 30, sources: [{ type: 'discover', media: 'movie', params: {} }] }, { get, resolve: fakeResolve() });
  expect((await feed.next()).length).toBe(20);
  expect((await feed.next()).length).toBe(10);
  expect(feed.done).toBe(true);
});
