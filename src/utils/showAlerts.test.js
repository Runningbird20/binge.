import { fetchShowAlerts, saveShowAlerts } from './showAlerts';
import { requireSupabase } from './data/shared';
import { getActiveProfileId } from './activeProfile';

jest.mock('./supabase', () => ({ isSupabaseConfigured: true, supabase: null }));
jest.mock('./activeProfile', () => ({ getActiveProfileId: jest.fn() }));
jest.mock('./data/shared', () => ({
  getAuthenticatedUser: async () => ({ id: 'u1' }),
  requireSupabase: jest.fn(),
  scopeToProfile: (query) => query,
}));

// The tables: what each read answers, and what was written.
function tables({ choice = null, choiceError = null, list = [], watching = [] } = {}) {
  const writes = [];
  const reads = [];
  requireSupabase.mockReturnValue({
    from(table) {
      const filters = [];
      const query = {
        select: () => query,
        eq: (column, value) => { filters.push([column, value]); return query; },
        is: (column, value) => { filters.push([column, value]); return query; },
        maybeSingle: async () => { reads.push([table, filters]); return { data: choice, error: choiceError }; },
        then: (resolve) => resolve({ data: table === 'watchlist' ? list : watching, error: null }),
        insert: async (row) => { writes.push(['insert', row]); return { error: null }; },
        update: (row) => ({ eq: async (column, value) => { writes.push(['update', row, [column, value]]); return { error: null }; } }),
      };
      return query;
    },
  });
  return { writes, reads };
}

beforeEach(() => getActiveProfileId.mockReturnValue('p1'));

test('a show on the list (not finished) or in Continue Watching is followed already', async () => {
  tables({ list: [{ status: 'watching' }] });
  await expect(fetchShowAlerts(10)).resolves.toBe(true);
  tables({ watching: [{ id: 3 }] });
  await expect(fetchShowAlerts(10)).resolves.toBe(true);
  tables({ list: [{ status: 'watched' }] }); // finished
  await expect(fetchShowAlerts(10)).resolves.toBe(false);
  tables();
  await expect(fetchShowAlerts(10)).resolves.toBe(false);
});

test('the profile’s own choice wins either way', async () => {
  const { reads } = tables({ choice: { following: false }, list: [{ status: 'watching' }] });
  await expect(fetchShowAlerts(10)).resolves.toBe(false);
  expect(reads).toEqual([['show_alerts', [['user_id', 'u1'], ['media_id', 10], ['profile_id', 'p1']]]]);
  tables({ choice: { following: true } });
  await expect(fetchShowAlerts(10)).resolves.toBe(true);
});

test('before the migration, only the list rule applies', async () => {
  tables({ choiceError: { code: 'PGRST205', message: 'no table' }, list: [{ status: 'plan_to_watch' }] });
  await expect(fetchShowAlerts(10)).resolves.toBe(true);
});

test('a first choice adds the profile’s row; a later one changes it', async () => {
  let { writes } = tables();
  await saveShowAlerts(10, true);
  expect(writes).toEqual([['insert', { user_id: 'u1', profile_id: 'p1', media_id: 10, following: true, updated_at: expect.any(String) }]]);

  ({ writes } = tables({ choice: { id: 42 } }));
  await saveShowAlerts(10, false);
  expect(writes).toEqual([['update', { following: false, updated_at: expect.any(String) }, ['id', 42]]]);
});

test('without a profile, the row is the account’s (profile_id null)', async () => {
  getActiveProfileId.mockReturnValue(null);
  const { reads } = tables({ choice: { following: true } });
  await fetchShowAlerts(10);
  expect(reads[0][1]).toContainEqual(['profile_id', null]);
});
