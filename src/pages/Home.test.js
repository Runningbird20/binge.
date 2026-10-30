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
