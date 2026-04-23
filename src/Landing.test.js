import { render, screen, waitFor, within } from '@testing-library/react';
import Landing from './pages/Landing';
import { loadFallbackMovies, loadFallbackTvShows } from './catalogFallback';
import { useAuth } from './contexts/AuthContext';

jest.mock(
  'react-router-dom',
  () => ({
    __esModule: true,
    Link: ({ children, to, ...props }) => <a href={typeof to === 'string' ? to : '#'} {...props}>{children}</a>,
    Navigate: ({ to }) => <div data-testid="navigate" data-to={to} />,
  }),
  { virtual: true }
);

jest.mock('./catalogFallback', () => ({
  loadFallbackMovies: jest.fn(),
  loadFallbackTvShows: jest.fn(),
}));

jest.mock('./contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

describe('Landing', () => {
  beforeEach(() => {
    const MockImage = jest.fn().mockImplementation(() => {
      let srcValue = '';

      return {
        decoding: '',
        loading: '',
        complete: false,
        onload: null,
        onerror: null,
        set src(value) {
          srcValue = value;
          this.complete = true;

          if (typeof this.onload === 'function') {
            this.onload();
          }
        },
        get src() {
          return srcValue;
        },
      };
    });

    window.Image = MockImage;
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    window.requestAnimationFrame = jest.fn(() => 1);
    window.cancelAnimationFrame = jest.fn();

    useAuth.mockReturnValue({
      isAuthenticated: false,
      authLoading: false,
      user: null,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('shows a capped mixed movie and TV carousel filtered to 2015 through 2024', async () => {
    loadFallbackMovies.mockResolvedValue([
      ...Array.from({ length: 38 }, (_, index) => ({
        id: index + 1,
        title: `Movie ${String(index).padStart(2, '0')}`,
        year: 2024,
        poster_url: `https://example.com/movie-${index}.jpg`,
        source_key: `movie-${index}`,
      })),
      {
        id: 500,
        title: 'Project Hail Mary',
        year: 2026,
        poster_url: 'https://example.com/hail-mary.jpg',
        source_key: 'movie-hail-mary',
      },
      {
        id: 501,
        title: 'No Poster Movie',
        year: 2018,
        poster_url: '',
        source_key: 'movie-no-poster',
      },
    ]);

    loadFallbackTvShows.mockResolvedValue([
      {
        id: 7,
        title: 'The Bear',
        year: 2022,
        poster_url: 'https://example.com/the-bear.jpg',
        source_key: 'tv-the-bear',
      },
      {
        id: 8,
        title: 'Criminal Minds',
        year: 2005,
        poster_url: 'https://example.com/criminal-minds.jpg',
        source_key: 'tv-criminal-minds',
      },
      {
        id: 9,
        title: 'Dark',
        year: 2017,
        poster_url: 'https://example.com/dark.jpg',
        source_key: 'tv-dark',
      },
      {
        id: 10,
        title: 'The Last of Us',
        year: 2023,
        poster_url: 'https://example.com/the-last-of-us.jpg',
        source_key: 'tv-the-last-of-us',
      },
    ]);

    render(<Landing />);

    await waitFor(() => {
      expect(loadFallbackMovies).toHaveBeenCalledTimes(1);
      expect(loadFallbackTvShows).toHaveBeenCalledTimes(1);
    });

    const carouselRegion = await screen.findByRole('region', { name: /featured poster carousel/i });

    expect(screen.queryByRole('button', { name: /scroll spotlight titles left/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /scroll spotlight titles right/i })).not.toBeInTheDocument();

    expect(within(carouselRegion).getByRole('img', { name: /movie 00 poster/i })).toBeInTheDocument();
    expect(within(carouselRegion).getByRole('img', { name: /movie 37 poster/i })).toBeInTheDocument();
    expect(within(carouselRegion).getByRole('img', { name: /the last of us poster/i })).toBeInTheDocument();
    expect(within(carouselRegion).getByRole('img', { name: /the bear poster/i })).toBeInTheDocument();

    expect(within(carouselRegion).queryByRole('img', { name: /project hail mary poster/i })).not.toBeInTheDocument();
    expect(within(carouselRegion).queryByRole('img', { name: /criminal minds poster/i })).not.toBeInTheDocument();
    expect(within(carouselRegion).queryByRole('img', { name: /dark poster/i })).not.toBeInTheDocument();
    expect(within(carouselRegion).queryByText('No Poster Movie')).not.toBeInTheDocument();
    expect(within(carouselRegion).getAllByRole('img')).toHaveLength(40);
    expect(carouselRegion.querySelectorAll('img')).toHaveLength(80);
    expect(window.Image).toHaveBeenCalledTimes(40);
  });
});
