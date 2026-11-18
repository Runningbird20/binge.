import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ReleaseCalendar from './ReleaseCalendar';
import { exportToCalendar, loadReleaseCalendar } from '../utils/releaseCalendar';
import { getSettings, SETTINGS_EVENT } from '../utils/profileSettings';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ activeProfile: { id: 'p' } }) }));
jest.mock('../components/Navbar', () => () => null);
jest.mock('../utils/releaseCalendar', () => ({
  ...jest.requireActual('../utils/releaseCalendar'),
  loadReleaseCalendar: jest.fn(),
  exportToCalendar: jest.fn(),
}));
jest.mock('../utils/profileSettings', () => ({ ...jest.requireActual('../utils/profileSettings'), getSettings: jest.fn() }));

const release = (id, date, title, extra = {}) => ({ id, date, kind: 'episode', title, detail: `${title} detail`, url: `/tv-show/${id}`, image: null, ...extra });

// Wednesday, November 18, 2026: today has one release, Friday has four, and
// nothing comes out again until January. Severance and Shōgun are yours; the
// rest is coming to binge. for everyone.
const EVENTS = [
  release('a', '2026-11-18', 'Severance', { mine: true }),
  release('b', '2026-11-20', 'The Bear', { kind: 'series', detail: 'Series premiere' }),
  release('c', '2026-11-20', 'Slow Horses', { kind: 'season' }),
  release('d', '2026-11-20', 'Andor', { kind: 'movie', url: '/movie/d' }),
  release('e', '2026-11-20', 'Dune', { kind: 'movie', url: '/movie/e' }),
  release('f', '2027-01-10', 'Shōgun', { kind: 'season', mine: true }),
];

function setListSetting(calendarList) {
  getSettings.mockReturnValue({ calendarList });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 10, 18, 12));
  loadReleaseCalendar.mockResolvedValue({ events: EVENTS, renewed: [] });
  setListSetting(false);
});

afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
});

const dayPanel = () => screen.getByRole('region', { name: /^(Today|Friday|Sunday|Nothing)/ });

test('opens on this month’s grid, with today’s releases listed', async () => {
  render(<ReleaseCalendar />);

  expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Wednesday, November 18: Severance' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Today, November 18' })).toBeInTheDocument();
  expect(within(dayPanel()).getByRole('link', { name: 'Severance' })).toHaveAttribute('href', '/tv-show/a');
  // A busy day draws three and counts the rest.
  const friday = screen.getByRole('button', { name: 'Friday, November 20: The Bear, Slow Horses, Andor and 1 more' });
  expect(friday).toHaveAttribute('aria-pressed', 'false');
  expect(friday).toHaveTextContent('+1 more');
  // Days without releases aren't buttons.
  expect(screen.queryByRole('button', { name: /November 19/ })).not.toBeInTheDocument();
});

test('picking a day lists everything that comes out on it, each with its own calendar button', async () => {
  render(<ReleaseCalendar />);
  fireEvent.click(await screen.findByRole('button', { name: /^Friday, November 20/ }));

  expect(screen.getByRole('heading', { name: 'Friday, November 20' })).toBeInTheDocument();
  const panel = dayPanel();
  expect(within(panel).getAllByRole('link').map((link) => link.textContent)).toEqual(['The Bear', 'Slow Horses', 'Andor', 'Dune']);
  expect(within(panel).getByText('New series')).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: 'Add Dune to my calendar' }));
  expect(exportToCalendar).toHaveBeenCalledWith([EVENTS[4]], 'Dune.ics');
});

test('the arrows step through the months up to the last release, and an empty month points to the next one', async () => {
  render(<ReleaseCalendar />);
  await screen.findByRole('heading', { name: 'November 2026' });
  expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(screen.getByRole('heading', { name: 'December 2026' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Nothing in December' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Next release: January 2027/ }));
  expect(screen.getByRole('heading', { name: 'January 2027' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sunday, January 10: Shōgun' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(dayPanel()).getByRole('link', { name: 'Shōgun' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(screen.getByRole('heading', { name: 'Today, November 18' })).toBeInTheDocument();
});

test('“Add my releases to my calendar” exports your releases, not everything coming to binge.', async () => {
  render(<ReleaseCalendar />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add my releases to my calendar' }));
  expect(exportToCalendar).toHaveBeenCalledWith([EVENTS[0], EVENTS[5]]);
});

test('with none of your own releases there’s nothing to export, but the calendar still fills', async () => {
  loadReleaseCalendar.mockResolvedValue({ events: EVENTS.filter((event) => !event.mine), renewed: [] });
  render(<ReleaseCalendar />);
  expect(await screen.findByRole('button', { name: /^Friday, November 20/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add my releases to my calendar' })).not.toBeInTheDocument();
});

test('with the list setting on, releases are a list of dates; the setting switches it live', async () => {
  setListSetting(true);
  render(<ReleaseCalendar />);

  expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Friday' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Friday' })).toHaveTextContent('New seriesThe BearSeries premiere');
  expect(screen.queryByRole('heading', { name: 'November 2026' })).not.toBeInTheDocument();

  setListSetting(false);
  act(() => { window.dispatchEvent(new CustomEvent(SETTINGS_EVENT)); });
  expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Friday' })).not.toBeInTheDocument();
});

test('nothing scheduled at all: still this month’s grid, saying so', async () => {
  loadReleaseCalendar.mockResolvedValue({ events: [], renewed: [] });
  render(<ReleaseCalendar />);
  expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Nothing in November' })).toBeInTheDocument();
  expect(screen.getByText('No more releases are scheduled yet.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add my releases to my calendar' })).not.toBeInTheDocument();
});

test('nothing scheduled, as a list', async () => {
  setListSetting(true);
  loadReleaseCalendar.mockResolvedValue({ events: [], renewed: [] });
  render(<ReleaseCalendar />);
  expect(await screen.findByText('No releases are scheduled yet.')).toBeInTheDocument();
});
