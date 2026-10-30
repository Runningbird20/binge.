// Shared setup for the page tests (src/pages/*.test.js).
//
// Each test file still declares the router mock itself (jest.mock is hoisted
// per file), by delegating to `routerMock` here:
//   jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });
// and calls installPageTestHooks() once at the top level.
import { render } from '@testing-library/react';
import { AuthProvider } from '../contexts/AuthContext';
import * as supabaseCatalogModule from '../utils/catalogQueries';
import { invalidateCachedPrefix } from '../utils/sessionCache';

export const mockNavigate = jest.fn();
let searchParams = new URLSearchParams();
// What useSearchParams() returns for the next render, e.g. '?view=all'.
export function setMockSearchParams(query = '') { searchParams = new URLSearchParams(query); }

export const routerMock = {
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
  useSearchParams: () => [searchParams, jest.fn()],
  useLocation: () => ({ pathname: '', search: '', hash: '', state: null, key: 'test' }),
};


// Catalog page mocks. The pages fetch the catalog in several shapes (a
// count "probe", random windows, sorted pages) and dedupe what comes back,
// so these mocks simply return the (genre-filtered) fixture list on every
// call instead of trying to predict the call sequence.
export function mockBookCatalog(books) {
  // Every call returns the (genre-filtered) fixture list. Books.js dedupes
  // by id when it merges its probe + window batches, so returning the same
  // items each time is safe — and unlike counting calls, it doesn't break
  // when a genre click cancels a load cycle part-way through.
  return jest.spyOn(supabaseCatalogModule, 'fetchBooksPage').mockImplementation(({ pageSize, genre } = {}) => {
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

export function mockMovieCatalog(items, options) {
  return mockSegment('fetchMovieCatalogSegment', items, options);
}

export function mockTvCatalog(items, options) {
  return mockSegment('fetchTvShowCatalogSegment', items, options);
}


export function renderWithAuth(ui, user = null) {
  localStorage.clear();

  if (user) {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify(user));
  }

  return render(<AuthProvider>{ui}</AuthProvider>);
}

// beforeAll/beforeEach/afterEach every page test file needs.
export function installPageTestHooks() {
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
    // Pages hydrate from the per-tab cache first; one test's fixtures must not
    // show up in the next.
    invalidateCachedPrefix('');
    mockNavigate.mockReset();
    setMockSearchParams();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });
}
