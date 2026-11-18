import { render, waitFor } from '@testing-library/react';
import PushOpenedWatcher from './PushOpenedWatcher';
import { INBOX_READ_EVENT, markNotificationsRead } from '../utils/notificationsInbox';

// The router's location is the address bar's (called at render, after setup).
const mockCurrentLocation = () => ({ pathname: window.location.pathname, search: window.location.search, hash: '', state: null, key: 'test' });
jest.mock('react-router-dom', () => ({ useLocation: () => mockCurrentLocation() }), { virtual: true });
jest.mock('../utils/notificationsInbox', () => ({
  ...jest.requireActual('../utils/notificationsInbox'),
  markNotificationsRead: jest.fn(),
}));

let announced;
const onRead = (event) => announced.push(event.detail);

beforeEach(() => {
  announced = [];
  window.addEventListener(INBOX_READ_EVENT, onRead);
  markNotificationsRead.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  window.removeEventListener(INBOX_READ_EVENT, onRead);
  window.history.replaceState(null, '', '/');
});

test('a page opened from a push marks its alert read and takes ?notif= out of the address', async () => {
  window.history.replaceState({ usr: null, key: 'k1', idx: 3 }, '', '/tv-show/12?play=1&season=2&episode=5&notif=42');

  render(<PushOpenedWatcher />);

  expect(markNotificationsRead).toHaveBeenCalledWith([42]);
  expect(`${window.location.pathname}${window.location.search}`).toBe('/tv-show/12?play=1&season=2&episode=5');
  // The router's own history entry is kept as it was.
  expect(window.history.state).toEqual({ usr: null, key: 'k1', idx: 3 });
  await waitFor(() => expect(announced).toEqual([[42]]));
});

test('any other page is left alone', () => {
  window.history.replaceState(null, '', '/tv-show/12?play=1&reminder=3');
  render(<PushOpenedWatcher />);
  expect(markNotificationsRead).not.toHaveBeenCalled();
  expect(window.location.search).toBe('?play=1&reminder=3');
});

test('if marking fails, nothing is announced (the bell’s next load shows it unread)', async () => {
  markNotificationsRead.mockRejectedValue(new Error('offline'));
  window.history.replaceState(null, '', '/sports?notif=7');
  render(<PushOpenedWatcher />);
  expect(markNotificationsRead).toHaveBeenCalledWith([7]);
  await Promise.resolve();
  expect(announced).toEqual([]);
});
