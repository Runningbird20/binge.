import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FranchiseOrder from './FranchiseOrder';
import * as data from '../utils/supabaseData';
import { findFranchise } from '../utils/franchises';
import { resolveTmdbItems } from '../utils/catalogLookup';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });
jest.mock('./HScroll', () => ({ children }) => <ol>{children}</ol>);
let mockAuth = null;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../utils/franchises', () => ({ findFranchise: jest.fn() }));
jest.mock('../utils/catalogLookup', () => ({ resolveTmdbItems: jest.fn() }));
jest.mock('../utils/supabaseData', () => ({
  fetchSupabaseRatingMap: jest.fn(),
  fetchSupabaseWatchlistStatusMap: jest.fn(),
  fetchSupabaseContinueWatching: jest.fn(),
  markMoviesWatched: jest.fn(),
  undoMarkMoviesWatched: jest.fn(),
}));

// Five films: A rated, B in the library as "want to watch", C not in the
// library, D not on binge., E not out yet.
const RELEASE = [
  { tmdbId: 1, title: 'A', releaseDate: '2008-05-02' },
  { tmdbId: 2, title: 'B', releaseDate: '2010-05-07' },
  { tmdbId: 3, title: 'C', releaseDate: '2012-05-04' },
  { tmdbId: 4, title: 'D', releaseDate: '2014-04-04' },
  { tmdbId: 5, title: 'E', releaseDate: '2099-05-01' },
];
const CATALOG = [1, 2, 3, 5].map((tmdbId) => ({ id: 100 + tmdbId, title: `Movie ${tmdbId}`, _tmdb: { tmdbId } }));

function open(props = {}) {
  return render(<FranchiseOrder tmdbId={1} currentId={101} canMark {...props} />);
}

async function ready(name) {
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
  return screen.getByRole('button', { name });
}

beforeEach(() => {
  jest.clearAllMocks();
  findFranchise.mockResolvedValue({ name: 'Test Universe', release: RELEASE, story: [...RELEASE].reverse() });
  resolveTmdbItems.mockResolvedValue(CATALOG);
  data.fetchSupabaseRatingMap.mockResolvedValue({ 101: { media_id: 101 } });
  data.fetchSupabaseWatchlistStatusMap.mockResolvedValue({ 102: { id: 9002, status: 'plan_to_watch' } });
  data.fetchSupabaseContinueWatching.mockResolvedValue([]);
  data.markMoviesWatched.mockResolvedValue({ added: [{ id: 9003, mediaId: 103 }], changed: [{ id: 9002, mediaId: 102, status: 'plan_to_watch' }] });
  data.undoMarkMoviesWatched.mockResolvedValue();
});

test('Mark all watched marks the released films on binge. you haven’t watched, in one go', async () => {
  const onLibraryChange = jest.fn();
  open({ onLibraryChange });
  expect(await screen.findByText(/1 of 4 watched/)).toBeInTheDocument();
  fireEvent.click(await ready('Mark all watched'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Marked 2 movies watched.'));
  // B keeps its library row (status changes), C is added; A is rated, D isn't on binge., E isn't out.
  // (In the order on screen: story order, here the reverse of release.)
  expect(data.markMoviesWatched).toHaveBeenCalledWith([
    { mediaId: 103, entry: null },
    { mediaId: 102, entry: { id: 9002, status: 'plan_to_watch' } },
  ]);
  expect(onLibraryChange).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/3 of 4 watched/)).toBeInTheDocument();
  expect(screen.getByText('All watched')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark all watched' })).toBeNull();
});

test('Undo puts the library back the way it was', async () => {
  const onLibraryChange = jest.fn();
  open({ onLibraryChange });
  fireEvent.click(await ready('Mark all watched'));
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(data.undoMarkMoviesWatched).toHaveBeenCalledWith({
    added: [{ id: 9003, mediaId: 103 }],
    changed: [{ id: 9002, mediaId: 102, status: 'plan_to_watch' }],
  }));
  expect(await screen.findByText(/1 of 4 watched/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark all watched' })).toBeInTheDocument();
  expect(onLibraryChange).toHaveBeenCalledTimes(2);
});

test('a failed save is undone on screen and says why', async () => {
  data.markMoviesWatched.mockRejectedValue(new Error('Unable to save those movies.'));
  open();
  fireEvent.click(await ready('Mark all watched'));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unable to save those movies.'));
  expect(screen.getByText(/1 of 4 watched/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark all watched' })).toBeInTheDocument();
});

test('it waits for what you have watched to load, and shows only when you can mark', async () => {
  let loaded;
  data.fetchSupabaseWatchlistStatusMap.mockReturnValue(new Promise((resolve) => { loaded = resolve; }));
  const { unmount } = open();
  expect(await screen.findByRole('button', { name: 'Mark all watched' })).toBeDisabled();
  loaded({});
  await ready('Mark all watched');
  unmount();

  open({ canMark: false });
  expect(await screen.findByText('Test Universe')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark all watched' })).toBeNull();
});

test('collections without a story order get the button too', async () => {
  findFranchise.mockResolvedValue({ name: 'Plain Collection', release: RELEASE });
  open();
  expect(await ready('Mark all watched')).toBeInTheDocument();
  expect(screen.queryByRole('radiogroup')).toBeNull();
});

describe('a restricted profile', () => {
  beforeEach(() => { mockAuth = { activeProfile: { id: 'p1', is_kids: true, settings: { maturity: 'kids' } } }; });
  afterEach(() => { mockAuth = null; });

  test('only sees the movies within its level, numbered among themselves', async () => {
    // A and C pass the Kids filter; B is over it, D isn't on binge., E isn't out.
    resolveTmdbItems.mockResolvedValue(CATALOG.filter((item) => [1, 3].includes(item._tmdb.tmdbId)));
    const { container } = open();
    expect(await screen.findByText(/1 of 2 watched/)).toBeInTheDocument();
    expect(resolveTmdbItems).toHaveBeenCalledWith(RELEASE, 'movie', { kidsSafe: 'kids' });
    // Story order (the reverse of release): C then A.
    expect([...container.querySelectorAll('.fr-title')].map((node) => node.textContent)).toEqual(['C', 'A']);
    expect([...container.querySelectorAll('.fr-num')].map((node) => node.textContent)).toEqual(['1', '2']);
    expect(screen.queryByText(/not on binge\./)).toBeNull();
  });

  test('a franchise with fewer than two of its movies left isn’t shown', async () => {
    resolveTmdbItems.mockResolvedValue(CATALOG.filter((item) => item._tmdb.tmdbId === 1));
    const { container } = open();
    await waitFor(() => expect(resolveTmdbItems).toHaveBeenCalled());
    await waitFor(() => expect(data.fetchSupabaseRatingMap).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
