import { render, screen, waitFor } from '@testing-library/react';
import Home from './Home';
import * as AuthContextModule from '../contexts/AuthContext';
import * as supabaseDataModule from '../utils/supabaseData';
import { installPageTestHooks } from '../testUtils/pageTestSetup';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });

installPageTestHooks();

test('shows avatar and welcome message on the signed-in home page', async () => {
  localStorage.setItem('onboarding_done_7', '1');

  const useAuthSpy = jest.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    },
    authLoading: false,
  });
  const ratingsSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatings').mockResolvedValue([]);
  const watchlistSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseWatchlist').mockResolvedValue([]);
  const continueWatchingSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseContinueWatching').mockResolvedValue([]);

  render(<Home />);

  expect(await screen.findByText(/welcome back, mediafan/i)).toBeInTheDocument();

  await waitFor(() => {
    expect(
      screen.getAllByRole('img', { name: /mediafan avatar/i }).length
    ).toBeGreaterThan(0);
  });

  ratingsSpy.mockRestore();
  watchlistSpy.mockRestore();
  continueWatchingSpy.mockRestore();
  useAuthSpy.mockRestore();
});

test('resume links for in-progress movies launch the player instead of the card', async () => {
  localStorage.setItem('onboarding_done_7', '1');

  const useAuthSpy = jest.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    },
    authLoading: false,
  });
  const ratingsSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatings').mockResolvedValue([]);
  const watchlistSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseWatchlist').mockResolvedValue([]);
  const continueWatchingSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseContinueWatching').mockResolvedValue([
    {
      id: 12,
      media_type: 'movie',
      media_id: 42,
      title: 'Interstellar',
      image_url: 'https://example.com/interstellar.jpg',
    },
  ]);

  render(<Home />);

  const resumeLink = await screen.findByRole('link', { name: /^resume interstellar$/i });
  expect(resumeLink).toHaveAttribute('href', '/movie/42?play=1');

  ratingsSpy.mockRestore();
  watchlistSpy.mockRestore();
  continueWatchingSpy.mockRestore();
  useAuthSpy.mockRestore();
});

test('shows an account settings gear link for signed-in users', async () => {
  localStorage.setItem('onboarding_done_7', '1');

  const useAuthSpy = jest.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    },
    authLoading: false,
  });
  const ratingsSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatings').mockResolvedValue([]);
  const watchlistSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseWatchlist').mockResolvedValue([]);
  const continueWatchingSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseContinueWatching').mockResolvedValue([]);

  render(<Home />);

  expect(screen.getByRole('link', { name: /account settings/i })).toBeInTheDocument();

  await waitFor(() => {
    expect(ratingsSpy).toHaveBeenCalled();
    expect(watchlistSpy).toHaveBeenCalled();
    expect(continueWatchingSpy).toHaveBeenCalled();
  });

  ratingsSpy.mockRestore();
  watchlistSpy.mockRestore();
  continueWatchingSpy.mockRestore();
  useAuthSpy.mockRestore();
});

test('a show whose newest episode is marked watched, with nothing saved partway, leaves Continue Watching', async () => {
  localStorage.setItem('onboarding_done_7', '1');
  const tmdbModule = require('../utils/tmdb');

  const useAuthSpy = jest.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: { id: 7, username: 'mediafan', email: 'mediafan@example.com' },
    authLoading: false,
  });
  const ratingsSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatings').mockResolvedValue([]);
  const watchlistSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseWatchlist').mockResolvedValue([]);
  const continueWatchingSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseContinueWatching').mockResolvedValue([
    // Caught up: on the newest episode, which is marked watched; no position.
    { id: 1, media_type: 'tv_show', media_id: 501, title: 'Finished Show', source_key: 'tmdb:tv:100', current_season: 2, current_episode: 5 },
    // Still going: three more episodes have aired.
    { id: 2, media_type: 'tv_show', media_id: 502, title: 'Ongoing Show', source_key: 'tmdb:tv:200', current_season: 1, current_episode: 5 },
    // On its newest episode, marked watched, but stopped partway: stays.
    { id: 3, media_type: 'tv_show', media_id: 503, title: 'Paused Show', source_key: 'tmdb:tv:300', current_season: 1, current_episode: 8, position_seconds: 600, duration_seconds: 2700 },
  ]);
  const details = {
    '/tv/100': { seasons: [{ season_number: 2, episode_count: 5 }], last_episode_to_air: { season_number: 2, episode_number: 5 } },
    '/tv/200': { seasons: [{ season_number: 1, episode_count: 8 }], last_episode_to_air: { season_number: 1, episode_number: 8 } },
    '/tv/300': { seasons: [{ season_number: 1, episode_count: 8 }], last_episode_to_air: { season_number: 1, episode_number: 8 } },
  };
  const tmdbSpy = jest.spyOn(tmdbModule, 'tmdbGet').mockImplementation((path) => Promise.resolve(details[path] || null));
  const watchedSpy = jest.spyOn(supabaseDataModule, 'fetchWatchedAmong').mockResolvedValue(new Set(['501:2:5', '503:1:8']));

  render(<Home />);

  await waitFor(() => expect(watchedSpy).toHaveBeenCalled());
  // Only shows with nothing saved are checked, each for its newest episode.
  expect(watchedSpy.mock.calls[0][0]).toEqual([{ mediaId: 501, season: 2, episode: 5 }, { mediaId: 502, season: 1, episode: 8 }]);
  const inRow = (title) => screen.queryByRole('button', { name: `Remove ${title} from Continue Watching` });
  await waitFor(() => expect(inRow('Finished Show')).toBeNull());
  expect(inRow('Ongoing Show')).toBeInTheDocument();
  expect(inRow('Paused Show')).toBeInTheDocument();

  [ratingsSpy, watchlistSpy, continueWatchingSpy, tmdbSpy, watchedSpy, useAuthSpy].forEach((spy) => spy.mockRestore());
});
