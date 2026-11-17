import { fireEvent, render, screen, within } from '@testing-library/react';
import NotificationBell from './NotificationBell';
import useDeviceType from '../hooks/useDeviceType';
import { fetchNotifications, markNotificationsRead } from '../utils/notificationsInbox';
import { mockNavigate } from '../testUtils/pageTestSetup';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ activeProfile: { id: 'p1', name: 'Sam' } }) }));
jest.mock('../hooks/useDeviceType', () => jest.fn());
jest.mock('../utils/notificationsInbox', () => ({
  ...jest.requireActual('../utils/notificationsInbox'),
  INBOX_AVAILABLE: true, // Jest has no Supabase
  fetchNotifications: jest.fn(),
  markNotificationsRead: jest.fn(),
}));

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const ALERTS = [
  { id: 3, kind: 'episode', title: 'New episode: Severance', body: 'S2 · E5 is out now.', url: '/tv-show/12?play=1&season=2&episode=5', created_at: minutesAgo(5), read_at: null },
  { id: 2, kind: 'game', title: 'Close game: BOS 101–99 NYK', body: 'Q4 2:31.', url: '/sports', created_at: minutesAgo(180), read_at: null },
  { id: 1, kind: 'announcement', title: 'Your alerts now stay 30 days', body: 'Find them under the bell.', url: '/home', created_at: minutesAgo(30 * 60), read_at: minutesAgo(29 * 60) },
];

beforeEach(() => {
  useDeviceType.mockReturnValue({ isMobile: false });
  // A stand-in for the table: what's marked read stays read.
  let rows = ALERTS.map((alert) => ({ ...alert }));
  fetchNotifications.mockReset().mockImplementation(async () => rows.map((row) => ({ ...row })));
  markNotificationsRead.mockReset().mockImplementation(async (ids) => {
    rows = rows.map((row) => (ids.includes(row.id) && !row.read_at ? { ...row, read_at: new Date().toISOString() } : row));
  });
  mockNavigate.mockReset();
});

async function openInbox() {
  render(<NotificationBell />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
  return screen.getByRole('dialog', { name: 'Notifications' });
}

test('the bell says how many alerts this profile hasn’t read', async () => {
  render(<NotificationBell />);
  expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
  expect(fetchNotifications).toHaveBeenCalledWith({ profileId: 'p1' });
});

test('it lists the last 30 days, newest first, marking the unread ones', async () => {
  const panel = await openInbox();
  const alerts = within(panel).getAllByRole('listitem');
  expect(alerts).toHaveLength(3);
  expect(within(alerts[0]).getByText('New episode: Severance')).toBeInTheDocument();
  expect(within(alerts[0]).getByText('Unread:')).toBeInTheDocument();
  expect(within(alerts[0]).getByText('5 min ago')).toBeInTheDocument();
  expect(within(alerts[1]).getByText('3 h ago')).toBeInTheDocument();
  expect(within(alerts[2]).queryByText('Unread:')).toBeNull();
  expect(within(alerts[2]).getByText('Yesterday')).toBeInTheDocument();
});

test('opening an alert marks it read and goes to its link', async () => {
  const panel = await openInbox();
  fireEvent.click(within(panel).getByRole('button', { name: /New episode: Severance/ }));
  expect(markNotificationsRead).toHaveBeenCalledWith([3]);
  expect(mockNavigate).toHaveBeenCalledWith('/tv-show/12?play=1&season=2&episode=5');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
});

test('Mark all read clears every dot', async () => {
  const panel = await openInbox();
  fireEvent.click(within(panel).getByRole('button', { name: 'Mark all read' }));
  expect(markNotificationsRead).toHaveBeenCalledWith([3, 2]);
  expect(within(panel).queryByText('Unread:')).toBeNull();
  expect(within(panel).queryByRole('button', { name: 'Mark all read' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
});

test('Escape closes the list', async () => {
  await openInbox();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('with nothing in it, it says All caught up and what shows up here', async () => {
  fetchNotifications.mockResolvedValue([]);
  render(<NotificationBell />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  expect(await screen.findByText('All caught up')).toBeInTheDocument();
  expect(screen.getByText('New episodes, reminders, your teams’ games and announcements show up here.')).toBeInTheDocument();
  expect(screen.queryByText(/Couldn’t load/)).toBeNull();
  expect(screen.queryByRole('link')).toBeNull(); // new-episode alerts don't need notifications on
});

test('a list that couldn’t load offers Try again', async () => {
  fetchNotifications.mockRejectedValue(new Error('offline'));
  render(<NotificationBell />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  const retry = await screen.findByRole('button', { name: 'Try again' });
  fetchNotifications.mockResolvedValue(ALERTS);
  fireEvent.click(retry);
  expect(await screen.findByText('New episode: Severance')).toBeInTheDocument();
});

test('phones: the list opens as a bottom sheet', async () => {
  useDeviceType.mockReturnValue({ isMobile: true });
  render(<NotificationBell />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
  const sheet = screen.getByRole('dialog', { name: 'Notifications' });
  expect(within(sheet).getByText('Close game: BOS 101–99 NYK')).toBeInTheDocument();
  expect(within(sheet).queryByRole('heading', { name: 'Notifications' })).toBeNull(); // the sheet has its own title
});
