import { markStartedWatching } from './library';
import { requireSupabase } from './shared';
import { getActiveProfileId } from '../activeProfile';

jest.mock('../supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
jest.mock('../activeProfile', () => ({ getActiveProfileId: jest.fn() }));
jest.mock('./shared', () => ({
  ...jest.requireActual('./shared'),
  requireSupabase: jest.fn(),
  getAuthenticatedUser: async () => ({ id: 'u1' }),
  scopeToProfile: (query, profileId) => query.eq('profile_id', profileId),
}));

// In-memory tables answering the reads and writes markStartedWatching makes.
function database(tables) {
  const writes = [];
  requireSupabase.mockReturnValue({
    from(table) {
      const filters = [];
      let patch = null;
      const rows = () => (tables[table] || []).filter((row) => filters.every(([column, value]) => row[column] === value));
      const query = {
        select: () => query,
        eq: (column, value) => { filters.push([column, value]); return query; },
        limit: () => query,
        update: (values) => { patch = values; return query; },
        insert: async (row) => { writes.push(['insert', table, row]); tables[table] = [...(tables[table] || []), row]; return { error: null }; },
        then: (resolve) => {
          if (patch) {
            rows().forEach((row) => Object.assign(row, patch));
            writes.push(['update', table, patch]);
            return resolve({ error: null });
          }
          return resolve({ data: rows(), error: null });
        },
      };
      return query;
    },
  });
  return writes;
}

beforeEach(() => getActiveProfileId.mockReturnValue('p1'));

test('a title started for the first time goes on the list as Watching, a series with its episode', async () => {
  let writes = database({});
  await expect(markStartedWatching({ mediaType: 'movie', mediaId: 7 })).resolves.toBe('added');
  expect(writes).toEqual([['insert', 'watchlist', { user_id: 'u1', profile_id: 'p1', media_type: 'movie', media_id: 7, status: 'watching' }]]);

  writes = database({});
  await markStartedWatching({ mediaType: 'tv_show', mediaId: 42, currentSeason: 2, currentEpisode: 3 });
  expect(writes[0][2]).toMatchObject({ media_type: 'tv_show', media_id: 42, status: 'watching', current_season: 2, current_episode: 3 });
});

test('saved for later (Plan to Watch), it moves to Watching', async () => {
  const tables = { watchlist: [{ id: 5, user_id: 'u1', profile_id: 'p1', media_type: 'movie', media_id: 7, status: 'plan_to_watch' }] };
  const writes = database(tables);
  await expect(markStartedWatching({ mediaType: 'movie', mediaId: 7 })).resolves.toBe('moved');
  expect(tables.watchlist[0].status).toBe('watching');
  expect(writes.filter(([kind]) => kind === 'insert')).toEqual([]);
});

test('already Watching or Watched, or rated: left as it is', async () => {
  const row = (status) => ({ id: 5, user_id: 'u1', profile_id: 'p1', media_type: 'movie', media_id: 7, status });
  for (const status of ['watching', 'watched']) {
    const writes = database({ watchlist: [row(status)] });
    // eslint-disable-next-line no-await-in-loop
    await expect(markStartedWatching({ mediaType: 'movie', mediaId: 7 })).resolves.toBeNull();
    expect(writes).toEqual([]);
  }
  // A rated title lives in Ratings & Reviews, not the list.
  const writes = database({ movie_ratings: [{ id: 1, user_id: 'u1', profile_id: 'p1', media_id: 7 }] });
  await expect(markStartedWatching({ mediaType: 'movie', mediaId: 7 })).resolves.toBeNull();
  expect(writes).toEqual([]);
});

test('another profile’s list and ratings don’t count', async () => {
  const writes = database({
    watchlist: [{ id: 5, user_id: 'u1', profile_id: 'p2', media_type: 'movie', media_id: 7, status: 'watched' }],
    movie_ratings: [{ id: 1, user_id: 'u1', profile_id: 'p2', media_id: 7 }],
  });
  await expect(markStartedWatching({ mediaType: 'movie', mediaId: 7 })).resolves.toBe('added');
  expect(writes[0][2]).toMatchObject({ profile_id: 'p1', status: 'watching' });
});
