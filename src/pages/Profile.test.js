import { fireEvent, render, screen } from '@testing-library/react';
import Profile from './Profile';
import * as data from '../utils/supabaseData';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', username: 'Cristal' }, activeProfile: { id: 'profile-1', name: 'Cristal' } }),
}));
jest.mock('../components/Navbar', () => () => null);
jest.mock('../components/DownloadDataButton', () => () => null);
jest.mock('../utils/sessionCache', () => ({ getCached: () => null, setCached: () => {}, buildUserDataCacheKey: () => 'k' }));
jest.mock('../utils/tmdb', () => ({ ...jest.requireActual('../utils/tmdb'), tmdbGet: () => Promise.resolve(null) }));
jest.mock('../utils/supabaseData', () => ({
  fetchSupabaseWatchlist: jest.fn(),
  fetchSupabaseRatings: jest.fn(),
  updateSupabaseWatchlistStatus: jest.fn(),
  removeSupabaseWatchlistItem: jest.fn(),
}));

const row = (id, title, media_type, status, extra = {}) => ({ id, title, media_type, media_id: id * 10, status, ...extra });

beforeEach(() => {
  data.fetchSupabaseWatchlist.mockResolvedValue([
    row(1, 'Planned Movie', 'movie', 'plan_to_watch'),
    row(2, 'Watching Show', 'tv_show', 'watching'),
    row(3, 'Old Watch', 'movie', 'watched', { updated_at: '2026-01-01T00:00:00Z' }),
    row(4, 'Finished Book', 'book', 'read', { updated_at: '2026-06-01T00:00:00Z' }),
    row(5, 'Rated Watch', 'movie', 'watched'), // rated: lives under Ratings & Reviews
  ]);
  data.fetchSupabaseRatings.mockResolvedValue([{ media_type: 'movie', media_id: 50, title: 'Rated Watch', created_at: '2026-02-01T00:00:00Z' }]);
});

const tab = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

test('finished, unrated titles get their own Watched tab between My List and Ratings & Reviews', async () => {
  render(<Profile />);
  expect(await screen.findByText('Planned Movie')).toBeInTheDocument();
  // In this order, with their counts (the Ratings tab also carries its short phone label).
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((t) => t.textContent.split(/\s/)[0])).toEqual(['My', 'Watched', 'Ratings']);
  expect(tab('My List')).toHaveTextContent(/2$/);
  expect(tab('Watched')).toHaveTextContent(/2$/);
  expect(tab('Ratings')).toHaveTextContent(/1$/);
  // My List keeps to what's still to watch or in progress.
  expect(screen.getByText('Watching Show')).toBeInTheDocument();
  expect(screen.queryByText('Old Watch')).toBeNull();

  fireEvent.click(tab('Watched'));
  const titles = screen.getAllByText(/^(Planned Movie|Watching Show|Old Watch|Finished Book)$/).map((el) => el.textContent);
  expect(titles).toEqual(['Finished Book', 'Old Watch']); // newest first
  expect(screen.getByText(/rate one to move it to Ratings & Reviews/)).toBeInTheDocument();
  expect(screen.queryByText('Planned Movie')).toBeNull();
});

test('Watched explains itself when there is nothing in it', async () => {
  data.fetchSupabaseWatchlist.mockResolvedValue([row(1, 'Planned Movie', 'movie', 'plan_to_watch')]);
  data.fetchSupabaseRatings.mockResolvedValue([]);
  render(<Profile />);
  await screen.findByText('Planned Movie');
  fireEvent.click(tab('Watched'));
  expect(screen.getByText('Nothing watched and unrated.')).toBeInTheDocument();
  expect(screen.getByText(/wait here until you rate them/)).toBeInTheDocument();
});
