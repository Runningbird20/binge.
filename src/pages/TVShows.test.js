import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TVShows from './TVShows';
import * as AuthContextModule from '../contexts/AuthContext';
import * as supabaseDataModule from '../utils/supabaseData';
import { setMockSearchParams, mockTvCatalog, installPageTestHooks } from '../testUtils/pageTestSetup';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });

installPageTestHooks();

test('uses a genre chip filter bar on the TV shows page', async () => {
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  setMockSearchParams('?view=all');
  const allShows = [
    {
      id: 1,
      title: 'The Bear',
      year: 2022,
      genre: 'Comedy, Drama',
      synopsis: 'A chef returns home to run the family restaurant.',
      poster_url: 'https://example.com/the-bear.jpg',
    },
    {
      id: 2,
      title: 'Dark',
      year: 2017,
      genre: 'Mystery, Science Fiction, Thriller',
      synopsis: 'A missing child reveals a town-spanning time mystery.',
      poster_url: 'https://example.com/dark.jpg',
    },
    {
      id: 3,
      title: 'Blue Eye Samurai',
      year: 2023,
      genre: 'Action, Adventure, Animation',
      synopsis: 'A warrior seeks revenge in Edo-period Japan.',
      poster_url: 'https://example.com/blue-eye-samurai.jpg',
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
  const tvSegmentSpy = mockTvCatalog(allShows, {
    matchesGenre: (show, genreValues) =>
      show.genre.split(',').map((value) => value.trim()).some((value) => genreValues.includes(value)),
  });
  const ratingMapSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatingMap').mockResolvedValue({});

  render(<TVShows />);

  expect(await screen.findByText('Blue Eye Samurai')).toBeInTheDocument();
  expect(screen.getByText('Dark')).toBeInTheDocument();
  expect(screen.getByText('The Bear')).toBeInTheDocument();

  // 'Mystery' and 'Thriller' both fold into the "Crime & Mystery" chip
  // (TV_GENRE_GROUPS, distinct from movies' "Crime & Thriller" grouping).
  const genreBar = screen.getByRole('group', { name: /series genres/i });
  await userEvent.click(within(genreBar).getByRole('button', { name: /crime & mystery/i }));

  await waitFor(() => {
    expect(screen.getByText('Dark')).toBeInTheDocument();
    expect(screen.queryByText('Blue Eye Samurai')).not.toBeInTheDocument();
    expect(screen.queryByText('The Bear')).not.toBeInTheDocument();
  });

  useAuthSpy.mockRestore();
  tvSegmentSpy.mockRestore();
  ratingMapSpy.mockRestore();
});
