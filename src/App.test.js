import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Signup from './pages/Signup';
import Home from './pages/Home';
import AccountSettings from './pages/AccountSettings';
import Books from './pages/Books';
import Movies from './pages/Movies';
import TVShows from './pages/TVShows';
import * as AuthContextModule from './contexts/AuthContext';
import { AuthProvider } from './contexts/AuthContext';
import * as supabaseDataModule from './utils/supabaseData';
import * as supabaseCatalogModule from './utils/supabaseMovieCatalog';

const mockNavigate = jest.fn();
let mockSearchParams = new URLSearchParams();

// Catalog page mocks. The pages fetch the catalog in several shapes (a
// count "probe", random windows, sorted pages) and dedupe what comes back,
// so these mocks simply return the (genre-filtered) fixture list on every
// call instead of trying to predict the call sequence.
function mockBookCatalog(books) {
  // Every call returns the (genre-filtered) fixture list. Books.js dedupes
  // by id when it merges its probe + window batches, so returning the same
  // items each time is safe — and unlike counting calls, it doesn't break
  // when a genre click cancels a load cycle part-way through.
  return jest.spyOn(supabaseCatalogModule, 'fetchSupabaseBooksPage').mockImplementation(({ pageSize, genre } = {}) => {
    const genreValues = Array.isArray(genre) ? genre : (genre ? [genre] : []);
    const filtered = genreValues.length === 0
      ? books
      : books.filter((book) => genreValues.includes(book.genre));

    return Promise.resolve({
      items: filtered,
      total: filtered.length,
      page: 1,
      pageSize: pageSize || filtered.length,
      totalPages: 1,
      facets: { genres: [...new Set(books.map((b) => b.genre).filter(Boolean))] },
    });
  });
}

// Movies/TV catalog segments: every call returns the genre-filtered list,
// with the count and genre facets. Covers both load paths — the default
// "Most Popular" sorted page (one call carrying the count) and "Featured"
// random windows (deduped by the page) — without depending on call order.
function mockSegment(fnName, items, { matchesGenre } = {}) {
  const allGenres = [...new Set(items.flatMap((item) => item.genre.split(',').map((g) => g.trim())))];
  return jest.spyOn(supabaseCatalogModule, fnName).mockImplementation(({ genre } = {}) => {
    const genreValues = Array.isArray(genre) ? genre : (genre ? [genre] : []);
    const filtered = genreValues.length === 0
      ? items
      : items.filter((item) => matchesGenre(item, genreValues));
    return Promise.resolve({ items: filtered, total: filtered.length, facets: { genres: allGenres } });
  });
}

function mockMovieCatalog(items, options) {
  return mockSegment('fetchSupabaseMovieCatalogSegment', items, options);
}

function mockTvCatalog(items, options) {
  return mockSegment('fetchSupabaseTvShowCatalogSegment', items, options);
}

jest.mock(
  'react-router-dom',
  () => ({
    __esModule: true,
    Link: ({ children, to, ...props }) => <a href={typeof to === 'string' ? to : '#'} {...props}>{children}</a>,
    NavLink: ({ children, className, to, ...props }) => (
      <a
        href={typeof to === 'string' ? to : '#'}
        className={typeof className === 'function' ? className({ isActive: false }) : className}
        {...props}
      >
        {children}
      </a>
    ),
    Navigate: ({ to }) => <div data-testid="navigate" data-to={to} />,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [mockSearchParams, jest.fn()],
    useLocation: () => ({ pathname: '', search: '', hash: '', state: null, key: 'test' }),
  }),
  { virtual: true }
);

function renderWithAuth(ui, user = null) {
  localStorage.clear();

  if (user) {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify(user));
  }

  return render(<AuthProvider>{ui}</AuthProvider>);
}

beforeAll(() => {
  class MockFileReader {
    readAsDataURL(file) {
      this.result = `data:${file.type};base64,avatar-preview`;

      if (this.onload) {
        this.onload({ target: this });
      }
    }
  }

  global.FileReader = MockFileReader;
});

beforeEach(() => {
  mockNavigate.mockReset();
  mockSearchParams = new URLSearchParams();
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

test('renders signup fields for username, bio, avatar, and password', () => {
  renderWithAuth(<Signup />);

  expect(screen.getByRole('heading', { name: /create your account/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/upload avatar photo/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/bio/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
});

test('uses an uploaded photo as the avatar preview', async () => {
  renderWithAuth(<Signup />);

  const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText(/upload avatar photo/i), file);

  expect(screen.getByText(/avatar\.png selected for your avatar/i)).toBeInTheDocument();

  const preview = await screen.findByRole('img', { name: /avatar preview/i });
  expect(preview).toHaveAttribute('src', 'data:image/png;base64,avatar-preview');
});

test('creates an account with bio and avatar details', async () => {
  // AuthProvider's mount-time session bootstrap otherwise races real
  // Supabase network calls in this environment; short-circuit it so it
  // resolves deterministically instead of potentially clobbering the
  // profile signUp() writes to localStorage.
  const sessionProfileSpy = jest.spyOn(supabaseDataModule, 'getSupabaseSessionProfile').mockResolvedValue(null);
  const signUpSpy = jest.spyOn(supabaseDataModule, 'signUpWithSupabase').mockResolvedValue({
    user: {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'I keep a short list of everything I finish.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
      createdAt: null,
      userType: 'user',
      isAdmin: false,
      isDev: false,
    },
    requiresEmailConfirmation: false,
  });

  renderWithAuth(<Signup />);

  const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
  await userEvent.upload(screen.getByLabelText(/upload avatar photo/i), file);
  await userEvent.type(screen.getByLabelText(/username/i), 'mediafan');
  await userEvent.type(screen.getByLabelText(/email/i), 'mediafan@example.com');
  await userEvent.type(
    screen.getByLabelText(/bio/i),
    'I keep a short list of everything I finish.'
  );
  await userEvent.type(screen.getByLabelText(/password/i), 'secretpass123');
  await userEvent.click(screen.getByRole('button', { name: /create account/i }));

  await waitFor(() => {
    expect(signUpSpy).toHaveBeenCalledTimes(1);
  });

  expect(signUpSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      username: 'mediafan',
      email: 'mediafan@example.com',
      password: 'secretpass123',
      bio: 'I keep a short list of everything I finish.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    })
  );

  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith('/home');
  });
  await waitFor(() => {
    expect(JSON.parse(localStorage.getItem('user'))).toEqual(
      expect.objectContaining({
        username: 'mediafan',
        bio: 'I keep a short list of everything I finish.',
        avatarUrl: 'data:image/png;base64,avatar-preview',
      })
    );
  });

  signUpSpy.mockRestore();
  sessionProfileSpy.mockRestore();
});

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

  expect(screen.getByText(/welcome back, mediafan/i)).toBeInTheDocument();

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

  const resumeLink = await screen.findByRole('link', { name: /^resume$/i });
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

test('updates username and email from account settings', async () => {
  const updateProfileMock = jest.fn().mockResolvedValue({
    id: 7,
    username: 'newmediafan',
    email: 'newmediafan@example.com',
    bio: 'Always logging the next favorite.',
    avatarUrl: 'data:image/png;base64,avatar-preview',
  });

  const useAuthSpy = jest.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    },
    authLoading: false,
    updateProfile: updateProfileMock,
    updatePassword: jest.fn(),
    logout: jest.fn(),
  });

  render(<AccountSettings />);

  const usernameInput = screen.getByLabelText(/^username$/i);
  const emailInput = screen.getByLabelText(/^email$/i);

  await userEvent.clear(usernameInput);
  await userEvent.type(usernameInput, 'newmediafan');
  await userEvent.clear(emailInput);
  await userEvent.type(emailInput, 'newmediafan@example.com');
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => {
    expect(updateProfileMock).toHaveBeenCalledWith({
      username: 'newmediafan',
      email: 'newmediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    });
  });

  expect(await screen.findByText(/account details updated\./i)).toBeInTheDocument();

  useAuthSpy.mockRestore();
});

test('shows seeded books as clickable covers and adds a book to the library', async () => {
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  mockSearchParams = new URLSearchParams('?view=all');
  document.body.style.overflow = '';

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
  const booksPageSpy = mockBookCatalog([
    {
      id: 1,
      title: 'Dune',
      author: 'Frank Herbert',
      year: 1965,
      genre: 'Science Fiction',
      synopsis: 'Set on the desert planet Arrakis...',
      cover_url: 'https://covers.openlibrary.org/b/id/11481354-M.jpg',
    },
  ]);
  const watchlistSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseWatchlist').mockResolvedValue([]);
  const ratingMapSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatingMap').mockResolvedValue({});
  const addToLibrarySpy = jest.spyOn(supabaseDataModule, 'addSupabaseWatchlistItem').mockResolvedValue({ id: 12 });

  render(<Books />);

  expect(await screen.findByRole('button', { name: /open details for dune/i })).toBeInTheDocument();
  expect(screen.getByText(/frank herbert/i)).toBeInTheDocument();
  expect(document.body.style.overflow).toBe('');

  await userEvent.click(screen.getByRole('button', { name: /open details for dune/i }));

  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText(/set on the desert planet arrakis/i)).toBeInTheDocument();
  expect(document.body.style.overflow).toBe('hidden');

  // The grid tile has its own quick-add button too; use the one in the sheet.
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /add to library/i }));

  await waitFor(() => {
    expect(addToLibrarySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'book',
        mediaId: 1,
        status: 'plan_to_read',
      })
    );
  });

  expect(await screen.findByText(/added to your library\./i)).toBeInTheDocument();

  useAuthSpy.mockRestore();
  booksPageSpy.mockRestore();
  watchlistSpy.mockRestore();
  ratingMapSpy.mockRestore();
  addToLibrarySpy.mockRestore();
});

test('falls back to a placeholder when a book cover image fails to load', async () => {
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  mockSearchParams = new URLSearchParams('?view=all');
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
  const booksPageSpy = mockBookCatalog([
    {
      id: 1,
      title: 'Dune',
      author: 'Frank Herbert',
      year: 1965,
      genre: 'Science Fiction',
      synopsis: 'Set on the desert planet Arrakis...',
      cover_url: 'https://covers.openlibrary.org/b/id/missing-cover.jpg',
    },
  ]);
  const watchlistSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseWatchlist').mockResolvedValue([]);
  const ratingMapSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatingMap').mockResolvedValue({});

  render(<Books />);

  await screen.findByRole('button', { name: /open details for dune/i });

  // Discovering the catalog's genres from the first fetch updates state that
  // (via a useMemo returning a fresh empty-array literal) re-triggers the
  // load effect exactly once more, momentarily clearing and rebuilding the
  // book list — see mockBookCatalog's call count. Wait for that second cycle
  // to finish before grabbing element references, so they aren't stale by
  // the time we interact with them.
  await waitFor(() => {
    expect(booksPageSpy.mock.calls.length).toBeGreaterThanOrEqual(8);
  });

  const duneButton = await screen.findByRole('button', { name: /open details for dune/i });
  // The cover is decorative (alt=""); the button carries the title.
  const coverImage = duneButton.querySelector('img');
  expect(coverImage).not.toBeNull();

  fireEvent.error(coverImage);

  await waitFor(() => {
    expect(duneButton.querySelector('img')).toBeNull();
    expect(within(duneButton).getByText('D')).toBeInTheDocument();
  });

  useAuthSpy.mockRestore();
  booksPageSpy.mockRestore();
  watchlistSpy.mockRestore();
  ratingMapSpy.mockRestore();
});

test('uses a genre chip filter bar on the books page', async () => {
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  mockSearchParams = new URLSearchParams('?view=all');
  // 'Science Fiction' and 'Fiction' both map into BOOK_GENRE_GROUPS buckets
  // ("Fantasy & Sci-Fi" and "Fiction & Literature" respectively), which is
  // what actually renders as chips now — there's no search box, genre
  // <select>, or sort <select> on this page anymore.
  const allBooks = [
    {
      id: 1,
      title: 'Dune',
      author: 'Frank Herbert',
      year: 1965,
      genre: 'Science Fiction',
      synopsis: 'Set on the desert planet Arrakis...',
      cover_url: 'https://covers.openlibrary.org/b/id/11481354-M.jpg',
    },
    {
      id: 2,
      title: 'Emma',
      author: 'Jane Austen',
      year: 1815,
      genre: 'Fiction',
      synopsis: 'A clever and restless matchmaker stirs up trouble.',
      cover_url: 'https://covers.openlibrary.org/b/id/9876543-M.jpg',
    },
    {
      id: 3,
      title: 'Project Hail Mary',
      author: 'Andy Weir',
      year: 2021,
      genre: 'Science Fiction',
      synopsis: 'A lone astronaut wakes up with a mission to save Earth.',
      cover_url: 'https://covers.openlibrary.org/b/id/1234567-M.jpg',
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
  const booksPageSpy = mockBookCatalog(allBooks);
  const watchlistSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseWatchlist').mockResolvedValue([]);
  const ratingMapSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatingMap').mockResolvedValue({});

  render(<Books />);

  expect(await screen.findByRole('button', { name: /open details for dune/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open details for emma/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open details for project hail mary/i })).toBeInTheDocument();

  const genreBar = screen.getByRole('group', { name: /book genres/i });
  await userEvent.click(within(genreBar).getByRole('button', { name: /fantasy & sci-fi/i }));

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /open details for dune/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open details for project hail mary/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open details for emma/i })).not.toBeInTheDocument();
  });

  await userEvent.click(within(genreBar).getByRole('button', { name: /^featured$/i }));

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /open details for dune/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open details for emma/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open details for project hail mary/i })).toBeInTheDocument();
  });

  useAuthSpy.mockRestore();
  booksPageSpy.mockRestore();
  watchlistSpy.mockRestore();
  ratingMapSpy.mockRestore();
});

test('ignores a page-level search query on the movies page', async () => {
  // Movies' catalog view only ever reads a page-level "genre" param from the
  // URL (for deep-linking a genre chip) — a stray "?search=" has nothing to
  // be read by, so the catalog should render normally either way. This
  // guards against a future regression that starts reading it unexpectedly.
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  mockSearchParams = new URLSearchParams('?view=all&search=arrival');

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
  mockSearchParams = new URLSearchParams('?view=all');
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

test('uses a genre chip filter bar on the TV shows page', async () => {
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  mockSearchParams = new URLSearchParams('?view=all');
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

test('shows a back to top arrow after scrolling the books page', async () => {
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  mockSearchParams = new URLSearchParams('?view=all');
  const scrollToMock = jest.fn();

  Object.defineProperty(window, 'scrollY', {
    value: 0,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(window, 'scrollTo', {
    value: scrollToMock,
    writable: true,
    configurable: true,
  });

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
  const booksPageSpy = mockBookCatalog([
    {
      id: 1,
      title: 'Dune',
      author: 'Frank Herbert',
      year: 1965,
      genre: 'Science Fiction',
      synopsis: 'Set on the desert planet Arrakis...',
      cover_url: 'https://covers.openlibrary.org/b/id/11481354-M.jpg',
    },
  ]);
  const watchlistSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseWatchlist').mockResolvedValue([]);
  const ratingMapSpy = jest.spyOn(supabaseDataModule, 'fetchSupabaseRatingMap').mockResolvedValue({});

  render(<Books />);

  expect(await screen.findByRole('button', { name: /open details for dune/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /back to top/i })).not.toBeInTheDocument();

  window.scrollY = 500;
  fireEvent.scroll(window);

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /back to top/i })).toBeInTheDocument();
  });

  await userEvent.click(screen.getByRole('button', { name: /back to top/i }));

  expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

  useAuthSpy.mockRestore();
  booksPageSpy.mockRestore();
  watchlistSpy.mockRestore();
  ratingMapSpy.mockRestore();
});
