import {
  belongsToProfile, fetchNotifications, inboxIdFromLink, subscribeToInbox, withoutInboxId,
} from './notificationsInbox';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({ isSupabaseConfigured: true, supabase: { from: jest.fn(), channel: jest.fn(), removeChannel: jest.fn() } }));

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

describe('Realtime', () => {
  // A channel that records what it listens for and hands its callbacks back.
  function fakeChannel() {
    const channel = { listeners: [], on: jest.fn((type, filter, callback) => { channel.listeners.push({ type, filter, callback }); return channel; }) };
    channel.subscribe = jest.fn((onStatus) => { channel.onStatus = onStatus; return channel; });
    return channel;
  }

  test('listens for this account’s new alerts and read marks, and stops when asked', () => {
    const channel = fakeChannel();
    supabase.channel.mockReturnValue(channel);
    const onChange = jest.fn();
    const onStatus = jest.fn();

    const unsubscribe = subscribeToInbox('u1', { onChange, onStatus });

    expect(supabase.channel).toHaveBeenCalledWith('inbox:u1');
    expect(channel.listeners.map(({ type, filter }) => [type, filter])).toEqual([
      ['postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.u1' }],
      ['postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: 'user_id=eq.u1' }],
    ]);
    channel.listeners[0].callback({ new: { id: 9, profile_id: null } });
    expect(onChange).toHaveBeenCalledWith({ id: 9, profile_id: null }, 'INSERT');
    channel.onStatus('SUBSCRIBED');
    expect(onStatus).toHaveBeenCalledWith('SUBSCRIBED');

    unsubscribe();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  test('without a signed-in account there’s nothing to listen to', () => {
    supabase.channel.mockClear();
    expect(subscribeToInbox(null, { onChange: jest.fn(), onStatus: jest.fn() })).toEqual(expect.any(Function));
    expect(supabase.channel).not.toHaveBeenCalled();
  });

  test('a profile sees its own alerts and the account’s, not another profile’s', () => {
    expect(belongsToProfile({ profile_id: 'p1' }, 'p1')).toBe(true);
    expect(belongsToProfile({ profile_id: null }, 'p1')).toBe(true);
    expect(belongsToProfile({ profile_id: 'p2' }, 'p1')).toBe(false);
    expect(belongsToProfile({ profile_id: 'p2' }, null)).toBe(true);
  });
});

describe('opening a push', () => {
  test('the alert’s id comes from ?notif= on the link the service worker opens', () => {
    expect(inboxIdFromLink('?play=1&season=2&episode=5&notif=42')).toBe(42);
    expect(inboxIdFromLink('?play=1')).toBeNull();
    expect(inboxIdFromLink('?notif=abc')).toBeNull();
    expect(inboxIdFromLink('?notif=-1')).toBeNull();
    expect(inboxIdFromLink('')).toBeNull();
  });

  test('it comes out of the address, leaving the rest as it was', () => {
    expect(withoutInboxId('https://binge.test/tv-show/12?play=1&notif=42&season=2#top')).toBe('/tv-show/12?play=1&season=2#top');
    expect(withoutInboxId('https://binge.test/sports?notif=7')).toBe('/sports');
  });
});
