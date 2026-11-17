import { fetchNotifications, timeAgo } from './notificationsInbox';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({ isSupabaseConfigured: true, supabase: { from: jest.fn() } }));

// A PostgREST query that answers `result` once awaited, whatever filters it gets.
function answers(result) {
  const query = {
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  ['select', 'gte', 'order', 'limit', 'or'].forEach((method) => { query[method] = () => query; });
  return query;
}

const NOW = Date.parse('2026-11-16T20:00:00Z');
const minutesAgo = (minutes) => new Date(NOW - minutes * 60000).toISOString();

test('alert times read like a notification list', () => {
  expect(timeAgo(minutesAgo(0.2), NOW)).toBe('Just now');
  expect(timeAgo(minutesAgo(5), NOW)).toBe('5 min ago');
  expect(timeAgo(minutesAgo(3 * 60), NOW)).toBe('3 h ago');
  expect(timeAgo(minutesAgo(30 * 60), NOW)).toBe('Yesterday');
  expect(timeAgo(minutesAgo(4 * 24 * 60), NOW)).toBe('4 days ago');
  // A clock a little ahead of the server's never shows "in the future".
  expect(timeAgo(minutesAgo(-2), NOW)).toBe('Just now');
});

test('before the inbox migration has run, the inbox is just empty', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  supabase.from.mockReturnValue(answers({ data: null, error: { code: 'PGRST205', message: 'Could not find the table \'public.notifications\' in the schema cache' } }));
  await expect(fetchNotifications({ profileId: 'p1' })).resolves.toEqual([]);
  await expect(fetchNotifications({ profileId: 'p1' })).resolves.toEqual([]);
  expect(warn).toHaveBeenCalledTimes(1); // says which migration to apply, once
  warn.mockRestore();
});

test('any other error is a failed load (the bell offers Try again)', async () => {
  supabase.from.mockReturnValue(answers({ data: null, error: { code: '500', message: 'upstream timeout' } }));
  await expect(fetchNotifications({ profileId: 'p1' })).rejects.toEqual(expect.objectContaining({ message: 'upstream timeout' }));
});

test('alerts come back as the table has them', async () => {
  const rows = [{ id: 1, kind: 'reminder', title: 'Time to watch Dune', body: '', url: '/movie/7', created_at: minutesAgo(5), read_at: null }];
  supabase.from.mockReturnValue(answers({ data: rows, error: null }));
  await expect(fetchNotifications({ profileId: 'p1' })).resolves.toEqual(rows);
  expect(supabase.from).toHaveBeenCalledWith('notifications');
});
