import { fetchEmailAlerts, saveEmailAlerts } from './emailAlerts';
import { getAuthenticatedUser, requireSupabase } from './data/shared';

jest.mock('./supabase', () => ({ isSupabaseConfigured: true, supabase: null }));
jest.mock('./data/shared', () => ({ getAuthenticatedUser: jest.fn(), requireSupabase: jest.fn() }));

// The email_alerts table: answers `result` to a read, records upserts.
function table(result) {
  const calls = { filters: [], upserts: [] };
  const query = {
    select: () => query,
    eq: (column, value) => { calls.filters.push([column, value]); return query; },
    maybeSingle: async () => result,
    upsert: async (row, options) => { calls.upserts.push([row, options]); return result; },
  };
  requireSupabase.mockReturnValue({ from: jest.fn((name) => { calls.table = name; return query; }) });
  return calls;
}

beforeEach(() => {
  getAuthenticatedUser.mockResolvedValue({ id: 'u1', email: 'one@example.com' });
});

test('an account that has never chosen reads as null (that’s when a reminder asks)', async () => {
  const calls = table({ data: null, error: null });
  await expect(fetchEmailAlerts()).resolves.toBeNull();
  expect(calls.table).toBe('email_alerts');
  expect(calls.filters).toEqual([['user_id', 'u1']]);
});

test('a choice reads back as on or off', async () => {
  table({ data: { enabled: true }, error: null });
  await expect(fetchEmailAlerts()).resolves.toBe(true);
  table({ data: { enabled: false }, error: null });
  await expect(fetchEmailAlerts()).resolves.toBe(false);
});

test('before the migration has run, it’s just off, and nothing asks', async () => {
  table({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } });
  await expect(fetchEmailAlerts()).resolves.toBe(false);
});

test('any other failure is an error', async () => {
  table({ data: null, error: { code: '500', message: 'upstream timeout' } });
  await expect(fetchEmailAlerts()).rejects.toEqual(expect.objectContaining({ message: 'upstream timeout' }));
});

test('saving writes the account’s one row', async () => {
  const calls = table({ error: null });
  await expect(saveEmailAlerts(true)).resolves.toBe(true);
  expect(calls.upserts).toEqual([[{ user_id: 'u1', enabled: true, updated_at: expect.any(String) }, { onConflict: 'user_id' }]]);
});

test('a save that fails says so', async () => {
  table({ error: { message: 'permission denied' } });
  await expect(saveEmailAlerts(false)).rejects.toThrow('Couldn’t save your email setting. Try again.');
});
