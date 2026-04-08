import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Signup from './pages/Signup';
import Home from './pages/Home';
import AccountSettings from './pages/AccountSettings';
import Books from './pages/Books';
import { AuthProvider } from './contexts/AuthContext';

const mockNavigate = jest.fn();

function mockResponse({ ok = true, status = 200, body = '', contentType = 'application/json' }) {
  return {
    ok,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: jest.fn().mockResolvedValue(body),
  };
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
  global.fetch.mockResolvedValue(
    mockResponse({
      body: JSON.stringify({
        token: 'test-token',
        user: {
          id: 7,
          username: 'mediafan',
          email: 'mediafan@example.com',
          bio: 'I keep a short list of everything I finish.',
          avatarUrl: 'data:image/png;base64,avatar-preview',
        },
      }),
    })
  );

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
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  expect(global.fetch).toHaveBeenCalledWith(
    '/api/auth/signup',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        username: 'mediafan',
        email: 'mediafan@example.com',
        password: 'secretpass123',
        bio: 'I keep a short list of everything I finish.',
        avatarUrl: 'data:image/png;base64,avatar-preview',
      }),
    })
  );

  expect(mockNavigate).toHaveBeenCalledWith('/home');
  expect(JSON.parse(localStorage.getItem('user'))).toEqual(
    expect.objectContaining({
      username: 'mediafan',
      bio: 'I keep a short list of everything I finish.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    })
  );
});

test('shows avatar and bio on the signed-in home page', async () => {
  renderWithAuth(
    <Home />,
    {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    }
  );

  global.fetch.mockImplementation((url) => {
    if (url === '/api/ratings/my' || url === '/api/watchlist') {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify([]),
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  expect(
    screen.getByRole('heading', { name: /welcome back, mediafan\./i })
  ).toBeInTheDocument();
  expect(screen.getAllByText(/always logging the next favorite\./i).length).toBeGreaterThan(0);

  await waitFor(() => {
    expect(
      screen.getAllByRole('img', { name: /mediafan avatar/i }).length
    ).toBeGreaterThan(0);
  });
});

test('shows an account settings gear link for signed-in users', () => {
  renderWithAuth(
    <Home />,
    {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    }
  );

  expect(screen.getByRole('link', { name: /account settings/i })).toBeInTheDocument();
});

test('updates username and email from account settings', async () => {
  global.fetch.mockResolvedValue(
    mockResponse({
      body: JSON.stringify({
        token: 'updated-token',
        user: {
          id: 7,
          username: 'newmediafan',
          email: 'newmediafan@example.com',
          bio: 'Always logging the next favorite.',
          avatarUrl: 'data:image/png;base64,avatar-preview',
        },
      }),
    })
  );

  renderWithAuth(
    <AccountSettings />,
    {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    }
  );

  const usernameInput = screen.getByLabelText(/^username$/i);
  const emailInput = screen.getByLabelText(/^email$/i);

  await userEvent.clear(usernameInput);
  await userEvent.type(usernameInput, 'newmediafan');
  await userEvent.clear(emailInput);
  await userEvent.type(emailInput, 'newmediafan@example.com');
  await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/account',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
        body: JSON.stringify({
          username: 'newmediafan',
          email: 'newmediafan@example.com',
        }),
      })
    );
  });

  expect(await screen.findByText(/account details updated\./i)).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('user'))).toEqual(
    expect.objectContaining({
      username: 'newmediafan',
      email: 'newmediafan@example.com',
    })
  );
  expect(localStorage.getItem('token')).toBe('updated-token');
});

test('shows seeded books as clickable covers and adds a book to the library', async () => {
  document.body.style.overflow = '';

  global.fetch.mockImplementation((url, options = {}) => {
    if (String(url).startsWith('/api/media/books?')) {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify({
            items: [
              {
                id: 1,
                title: 'Dune',
                author: 'Frank Herbert',
                year: 1965,
                genre: 'Science Fiction',
                synopsis: 'Set on the desert planet Arrakis...',
                cover_url: 'https://covers.openlibrary.org/b/id/11481354-M.jpg',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 24,
            totalPages: 1,
            facets: {
              genres: ['Science Fiction'],
              minYear: 1965,
              maxYear: 1965,
            },
          }),
        })
      );
    }

    if (url === '/api/watchlist?media_type=book' && (!options.method || options.method === 'GET')) {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify([]),
        })
      );
    }

    if (url === '/api/watchlist' && options.method === 'POST') {
      return Promise.resolve(
        mockResponse({
          status: 201,
          body: JSON.stringify({ id: 12 }),
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  renderWithAuth(
    <Books />,
    {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    }
  );

  expect(await screen.findByRole('button', { name: /open details for dune/i })).toBeInTheDocument();
  expect(screen.getByText(/frank herbert/i)).toBeInTheDocument();
  expect(document.body.style.overflow).toBe('');

  await userEvent.click(screen.getByRole('button', { name: /open details for dune/i }));

  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText(/set on the desert planet arrakis/i)).toBeInTheDocument();
  expect(document.body.style.overflow).toBe('hidden');

  await userEvent.click(screen.getByRole('button', { name: /add to library/i }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/watchlist',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
        body: JSON.stringify({
          media_type: 'book',
          media_id: 1,
          status: 'plan_to_read',
        }),
      })
    );
  });

  expect(await screen.findByText(/added to your library\./i)).toBeInTheDocument();
});

test('uses the top search bar and sidebar filters on the books page', async () => {
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
      genre: 'Classic Literature',
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

  global.fetch.mockImplementation((url, options = {}) => {
    if (String(url).startsWith('/api/media/books?')) {
      const parsedUrl = new URL(String(url), 'http://localhost');
      const search = (parsedUrl.searchParams.get('search') || '').toLowerCase();
      const genre = parsedUrl.searchParams.get('genre') || '';
      const minYear = Number(parsedUrl.searchParams.get('min_year') || '');
      const sort = parsedUrl.searchParams.get('sort') || 'title-asc';
      const page = Number(parsedUrl.searchParams.get('page') || '1');
      const pageSize = Number(parsedUrl.searchParams.get('page_size') || '24');

      let items = allBooks.filter((book) => {
        const matchesSearch =
          !search ||
          book.title.toLowerCase().includes(search) ||
          book.author.toLowerCase().includes(search);
        const matchesGenre = !genre || book.genre === genre;
        const matchesYear = !Number.isFinite(minYear) || minYear <= 0 || !book.year || book.year >= minYear;
        return matchesSearch && matchesGenre && matchesYear;
      });

      items = items.sort((left, right) => {
        if (sort === 'year-desc') return (right.year || 0) - (left.year || 0);
        if (sort === 'year-asc') return (left.year || 0) - (right.year || 0);
        return left.title.localeCompare(right.title);
      });

      const start = (page - 1) * pageSize;
      const pagedItems = items.slice(start, start + pageSize);

      return Promise.resolve(
        mockResponse({
          body: JSON.stringify({
            items: pagedItems,
            total: items.length,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(items.length / pageSize)),
            facets: {
              genres: ['Classic Literature', 'Science Fiction'],
              minYear: 1815,
              maxYear: 2021,
            },
          }),
        })
      );
    }

    if (url === '/api/watchlist?media_type=book' && (!options.method || options.method === 'GET')) {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify([]),
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  renderWithAuth(
    <Books />,
    {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    }
  );

  expect(await screen.findByText(/filter options/i)).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /open details for dune/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open details for emma/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /open details for project hail mary/i })).toBeInTheDocument();

  await userEvent.type(screen.getByRole('textbox', { name: /search the shelf/i }), 'Andy');

  await waitFor(() => {
    expect(screen.queryByRole('button', { name: /open details for dune/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open details for emma/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open details for project hail mary/i })).toBeInTheDocument();
  });

  await userEvent.clear(screen.getByRole('textbox', { name: /search the shelf/i }));

  await userEvent.click(screen.getByRole('button', { name: /^science fiction$/i }));

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /open details for dune/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open details for project hail mary/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open details for emma/i })).not.toBeInTheDocument();
  });

  fireEvent.change(screen.getByRole('slider', { name: /release date/i }), {
    target: { value: '2000' },
  });

  await waitFor(() => {
    expect(screen.queryByRole('button', { name: /open details for dune/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open details for emma/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open details for project hail mary/i })).toBeInTheDocument();
  });
});

test('shows a back to top arrow after scrolling the books page', async () => {
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

  global.fetch.mockImplementation((url, options = {}) => {
    if (String(url).startsWith('/api/media/books?')) {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify({
            items: [
              {
                id: 1,
                title: 'Dune',
                author: 'Frank Herbert',
                year: 1965,
                genre: 'Science Fiction',
                synopsis: 'Set on the desert planet Arrakis...',
                cover_url: 'https://covers.openlibrary.org/b/id/11481354-M.jpg',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 24,
            totalPages: 1,
            facets: {
              genres: ['Science Fiction'],
              minYear: 1965,
              maxYear: 1965,
            },
          }),
        })
      );
    }

    if (url === '/api/watchlist?media_type=book' && (!options.method || options.method === 'GET')) {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify([]),
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  renderWithAuth(
    <Books />,
    {
      id: 7,
      username: 'mediafan',
      email: 'mediafan@example.com',
      bio: 'Always logging the next favorite.',
      avatarUrl: 'data:image/png;base64,avatar-preview',
    }
  );

  expect(await screen.findByRole('button', { name: /open details for dune/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /back to top/i })).not.toBeInTheDocument();

  window.scrollY = 500;
  fireEvent.scroll(window);

  await waitFor(() => {
    expect(screen.getByRole('button', { name: /back to top/i })).toBeInTheDocument();
  });

  await userEvent.click(screen.getByRole('button', { name: /back to top/i }));

  expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
});
