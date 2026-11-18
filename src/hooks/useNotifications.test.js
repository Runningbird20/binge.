import { act, renderHook, waitFor } from '@testing-library/react';
import useNotifications from './useNotifications';
import { INBOX_READ_EVENT, fetchNotifications, subscribeToInbox } from '../utils/notificationsInbox';

jest.mock('../utils/notificationsInbox', () => ({
  ...jest.requireActual('../utils/notificationsInbox'),
  INBOX_AVAILABLE: true, // Jest has no Supabase
  fetchNotifications: jest.fn(),
  markNotificationsRead: jest.fn(),
  subscribeToInbox: jest.fn(),
}));

const alert = (id, extra = {}) => ({ id, kind: 'episode', title: `Alert ${id}`, body: '', url: '/home', created_at: '2026-11-18T12:00:00Z', read_at: null, ...extra });

let rows;
let channel; // the callbacks the hook gave subscribeToInbox
let unsubscribe;

beforeEach(() => {
  jest.useFakeTimers();
  rows = [alert(1)];
  fetchNotifications.mockReset().mockImplementation(async () => rows.map((row) => ({ ...row })));
  unsubscribe = jest.fn();
  subscribeToInbox.mockReset().mockImplementation((userId, callbacks) => { channel = { userId, ...callbacks }; return unsubscribe; });
});

afterEach(() => jest.useRealTimers());

async function loaded(userId = 'u1') {
  const view = renderHook(() => useNotifications('p1', userId));
  await waitFor(() => expect(view.result.current.items).toHaveLength(1));
  return view;
}

const loads = () => fetchNotifications.mock.calls.length;
async function elapse(ms) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}
async function send(callback) {
  await act(async () => { callback(); });
}

test('a new alert for this profile shows up at once, through Realtime', async () => {
  const { result } = await loaded();
  expect(subscribeToInbox).toHaveBeenCalledWith('u1', expect.any(Object));

  rows = [alert(2), alert(1)];
  await send(() => channel.onChange({ id: 2, profile_id: 'p1' }, 'INSERT'));
  await elapse(400);

  await waitFor(() => expect(result.current.unreadIds).toEqual([2, 1]));
});

test('an account-wide alert counts; another profile’s doesn’t', async () => {
  await loaded();
  const before = loads();

  await send(() => channel.onChange({ id: 3, profile_id: 'p2' }, 'INSERT'));
  await elapse(400);
  expect(loads()).toBe(before);

  await send(() => channel.onChange({ id: 4, profile_id: null }, 'INSERT'));
  await elapse(400);
  expect(loads()).toBe(before + 1);
});

test('a burst of changes (Mark all read on another device) is one reload', async () => {
  await loaded();
  const before = loads();
  await send(() => {
    [1, 2, 3, 4, 5].forEach((id) => channel.onChange({ id, profile_id: 'p1', read_at: '2026-11-18T12:05:00Z' }, 'UPDATE'));
  });
  await elapse(400);
  expect(loads()).toBe(before + 1);
});

test('every (re)connection reloads, so nothing sent while it was down is missed', async () => {
  await loaded();
  const before = loads();
  await send(() => channel.onStatus('SUBSCRIBED'));
  expect(loads()).toBe(before + 1);
  await send(() => channel.onStatus('CHANNEL_ERROR'));
  await send(() => channel.onStatus('SUBSCRIBED'));
  expect(loads()).toBe(before + 2);
});

test('while Realtime is connected, the 5-minute poll stands down; when it drops, the poll is back', async () => {
  await loaded();
  await send(() => channel.onStatus('SUBSCRIBED'));
  const live = loads();

  await elapse(10 * 60 * 1000);
  expect(loads()).toBe(live);

  await send(() => channel.onStatus('TIMED_OUT'));
  await elapse(5 * 60 * 1000);
  expect(loads()).toBe(live + 1);
});

test('connected, it still reloads every 30 minutes, in case Realtime isn’t sending', async () => {
  await loaded();
  await send(() => channel.onStatus('SUBSCRIBED'));
  const live = loads();
  await elapse(29 * 60 * 1000);
  expect(loads()).toBe(live);
  await elapse(2 * 60 * 1000); // checked once a minute
  expect(loads()).toBe(live + 1);
});

test('an alert marked read by opening its push reloads the list', async () => {
  const { result } = await loaded();
  rows = [alert(1, { read_at: '2026-11-18T12:05:00Z' })];
  await send(() => window.dispatchEvent(new CustomEvent(INBOX_READ_EVENT, { detail: [1] })));
  await waitFor(() => expect(result.current.unreadIds).toEqual([]));
});

test('it stops listening when the bell goes, and doesn’t listen without an account', async () => {
  const { unmount } = await loaded();
  unmount();
  expect(unsubscribe).toHaveBeenCalled();

  subscribeToInbox.mockClear();
  await loaded(null);
  expect(subscribeToInbox).not.toHaveBeenCalled();
});
