import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Books from './Books';
import * as AuthContextModule from '../contexts/AuthContext';
import * as supabaseDataModule from '../utils/supabaseData';
import { setMockSearchParams, mockBookCatalog, installPageTestHooks } from '../testUtils/pageTestSetup';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });

installPageTestHooks();

test('shows seeded books as clickable covers and adds a book to the library', async () => {
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  setMockSearchParams('?view=all');
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
  setMockSearchParams('?view=all');
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
  setMockSearchParams('?view=all');
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

test('shows a back to top arrow after scrolling the books page', async () => {
  // The catalog grid lives under "Browse all" (the page itself opens on rows).
  setMockSearchParams('?view=all');
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
