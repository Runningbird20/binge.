import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Movies from './Movies';
import * as AuthContextModule from '../contexts/AuthContext';
import * as supabaseDataModule from '../utils/supabaseData';
import { setMockSearchParams, mockMovieCatalog, installPageTestHooks } from '../testUtils/pageTestSetup';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });

installPageTestHooks();

test('ignores a page-level search query on the movies page', async () => {
  // Movies' catalog view only ever reads a page-level "genre" param from the
  // URL (for deep-linking a genre chip) — a stray "?search=" has nothing to
  // be read by, so the catalog should render normally either way. This
  // guards against a future regression that starts reading it unexpectedly.
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  setMockSearchParams('?view=all&search=arrival');

  const allMovies = [
    {
      id: 1,
      title: 'Arrival',
      year: 2016,
      genre: 'Science Fiction, Drama',
      synopsis: 'A linguist works to communicate with visitors from space.',
      poster_url: 'https://example.com/arrival.jpg',
    },
    {
      id: 2,
      title: 'Heat',
      year: 1995,
      genre: 'Crime, Drama',
      synopsis: 'A meticulous detective closes in on a career thief.',
      poster_url: 'https://example.com/heat.jpg',
    },
  ];

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
  const movieSegmentSpy = mockMovieCatalog(allMovies, {
    matchesGenre: (movie, genreValues) =>
      movie.genre.split(',').map((value) => value.trim()).some((value) => genreValues.includes(value)),
  });
  const ratingMapSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatingMap').mockResolvedValue({});

  render(<Movies />);

  expect(await screen.findByText('Arrival')).toBeInTheDocument();
  expect(screen.getByText('Heat')).toBeInTheDocument();

  useAuthSpy.mockRestore();
  movieSegmentSpy.mockRestore();
  ratingMapSpy.mockRestore();
});

test('uses a genre chip filter bar on the movies page', async () => {
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  setMockSearchParams('?view=all');
  const allMovies = [
    {
      id: 1,
      title: 'Arrival',
      year: 2016,
      genre: 'Science Fiction, Drama',
      synopsis: 'A linguist works to communicate with visitors from space.',
      poster_url: 'https://example.com/arrival.jpg',
    },
    {
      id: 2,
      title: 'Heat',
      year: 1995,
      genre: 'Crime, Drama',
      synopsis: 'A meticulous detective closes in on a career thief.',
      poster_url: 'https://example.com/heat.jpg',
    },
    {
      id: 3,
      title: 'Mad Max: Fury Road',
      year: 2015,
      genre: 'Action, Science Fiction',
      synopsis: 'Survivors race across the wasteland.',
      poster_url: 'https://example.com/fury-road.jpg',
    },
  ];

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
  const movieSegmentSpy = mockMovieCatalog(allMovies, {
    matchesGenre: (movie, genreValues) =>
      movie.genre.split(',').map((value) => value.trim()).some((value) => genreValues.includes(value)),
  });
  const ratingMapSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatingMap').mockResolvedValue({});

  render(<Movies />);

  expect(await screen.findByText('Arrival')).toBeInTheDocument();
  expect(screen.getByText('Heat')).toBeInTheDocument();
  expect(screen.getByText('Mad Max: Fury Road')).toBeInTheDocument();

  const genreBar = screen.getByRole('group', { name: /movie genres/i });
  await userEvent.click(within(genreBar).getByRole('button', { name: /fantasy & sci-fi/i }));

  await waitFor(() => {
    expect(screen.getByText('Arrival')).toBeInTheDocument();
    expect(screen.getByText('Mad Max: Fury Road')).toBeInTheDocument();
    expect(screen.queryByText('Heat')).not.toBeInTheDocument();
  });

  useAuthSpy.mockRestore();
  movieSegmentSpy.mockRestore();
  ratingMapSpy.mockRestore();
});
