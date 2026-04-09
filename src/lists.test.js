import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from './contexts/AuthContext';
import Lists from './pages/Lists';
import SharedList from './pages/SharedList';
import MediaDetailsModal from './components/MediaDetailsModal';

const mockNavigate = jest.fn();
const mockUseParams = jest.fn(() => ({ shareCode: 'movie-night-acde12' }));

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
    useParams: () => mockUseParams(),
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

beforeEach(() => {
  mockNavigate.mockReset();
  mockUseParams.mockReset();
  mockUseParams.mockReturnValue({ shareCode: 'movie-night-acde12' });
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

test('shows shareable links and lets owners invite collaborators on lists page', async () => {
  const currentList = {
    id: 7,
    name: 'Movie Night',
    share_code: 'movie-night-acde12',
    is_public: false,
    owner: { id: 1, username: 'owner' },
    permissions: {
      canView: true,
      canEdit: true,
      canManage: true,
      canVote: true,
      role: 'owner',
    },
    collaborators: [
      { id: 1, username: 'owner', role: 'owner' },
    ],
    items: [],
    consensus_pick: null,
  };

  const summary = [
    {
      id: 7,
      name: 'Movie Night',
      share_code: 'movie-night-acde12',
      is_public: false,
      owner_username: 'owner',
      item_count: 0,
      collaborator_count: 0,
      permissions: {
        canView: true,
        canEdit: true,
        canManage: true,
        canVote: true,
        role: 'owner',
      },
    },
  ];

  global.fetch.mockImplementation((url, options = {}) => {
    if (url === '/api/lists' && (!options.method || options.method === 'GET')) {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify(summary),
        })
      );
    }

    if (url === '/api/lists/7' && (!options.method || options.method === 'GET')) {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify(currentList),
        })
      );
    }

    if (url === '/api/lists/7/collaborators' && options.method === 'POST') {
      currentList.collaborators = [
        ...currentList.collaborators,
        { id: 2, username: 'friendfan', role: 'collaborator' },
      ];
      summary[0] = {
        ...summary[0],
        collaborator_count: 1,
      };

      return Promise.resolve(
        mockResponse({
          status: 201,
          body: JSON.stringify(currentList),
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  renderWithAuth(
    <Lists />,
    {
      id: 1,
      username: 'owner',
      email: 'owner@example.com',
    }
  );

  const shareInput = await screen.findByRole('textbox', { name: /shareable list url/i });
  expect(shareInput).toHaveValue('http://localhost/lists/movie-night-acde12');

  await userEvent.type(
    screen.getByRole('textbox', { name: /invite collaborator by username/i }),
    'friendfan'
  );
  await userEvent.click(screen.getByRole('button', { name: /invite collaborator/i }));

  expect(await screen.findByText(/invited friendfan to collaborate\./i)).toBeInTheDocument();
  expect(screen.getAllByText(/^friendfan$/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/2 people can edit and vibe-vote here\./i)).toBeInTheDocument();
});

test('saves a media item to a shared list from the detail modal', async () => {
  global.fetch.mockImplementation((url, options = {}) => {
    if (url === '/api/lists' && (!options.method || options.method === 'GET')) {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify([
            {
              id: 9,
              name: 'Friday Picks',
              permissions: { canEdit: true },
            },
          ]),
        })
      );
    }

    if (url === '/api/lists/9/items' && options.method === 'POST') {
      return Promise.resolve(
        mockResponse({
          status: 201,
          body: JSON.stringify({ name: 'Friday Picks' }),
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  renderWithAuth(
    <MediaDetailsModal
      item={{
        id: 12,
        title: 'Arrival',
        year: 2016,
        director: 'Denis Villeneuve',
        genre: 'Science Fiction',
        synopsis: 'A linguist works to communicate with visitors from space.',
        poster_url: 'https://example.com/arrival.jpg',
      }}
      mediaType="movie"
      onClose={() => {}}
      userRating={0}
    />,
    {
      id: 1,
      username: 'owner',
      email: 'owner@example.com',
    }
  );

  expect(await screen.findByRole('combobox', { name: /save to list/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /add to list/i }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/lists/9/items',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
        body: JSON.stringify({
          media_type: 'movie',
          media_id: 12,
        }),
      })
    );
  });

  expect(await screen.findByText(/saved "arrival" to friday picks\./i)).toBeInTheDocument();
});

test('updates the consensus pick when collaborators vibe-vote on a shared list', async () => {
  let sharedList = {
    id: 7,
    name: 'Movie Night',
    share_code: 'movie-night-acde12',
    is_public: true,
    owner: { id: 1, username: 'owner' },
    permissions: {
      canView: true,
      canEdit: true,
      canManage: false,
      canVote: true,
      role: 'collaborator',
    },
    collaborators: [
      { id: 1, username: 'owner', role: 'owner' },
      { id: 2, username: 'friendfan', role: 'collaborator' },
    ],
    items: [
      {
        id: 101,
        media_type: 'movie',
        title: 'Dune',
        creator_name: 'Denis Villeneuve',
        year: 2021,
        vibe_score: 0,
        upvotes: 0,
        downvotes: 0,
        my_vote: 0,
        position: 1,
      },
      {
        id: 102,
        media_type: 'movie',
        title: 'Arrival',
        creator_name: 'Denis Villeneuve',
        year: 2016,
        vibe_score: 2,
        upvotes: 2,
        downvotes: 0,
        my_vote: 0,
        position: 0,
      },
    ],
    consensus_pick: {
      id: 102,
      media_type: 'movie',
      title: 'Arrival',
      creator_name: 'Denis Villeneuve',
      year: 2016,
      vibe_score: 2,
      upvotes: 2,
      downvotes: 0,
      my_vote: 0,
      position: 0,
    },
  };

  global.fetch.mockImplementation((url, options = {}) => {
    if (url === '/api/lists/shared/movie-night-acde12' && (!options.method || options.method === 'GET')) {
      return Promise.resolve(
        mockResponse({
          body: JSON.stringify(sharedList),
        })
      );
    }

    if (url === '/api/lists/7/items/101/vote' && options.method === 'POST') {
      sharedList = {
        ...sharedList,
        items: sharedList.items.map((item) => (
          item.id === 101
            ? { ...item, vibe_score: 3, upvotes: 3, my_vote: 1 }
            : item
        )),
        consensus_pick: {
          id: 101,
          media_type: 'movie',
          title: 'Dune',
          creator_name: 'Denis Villeneuve',
          year: 2021,
          vibe_score: 3,
          upvotes: 3,
          downvotes: 0,
          my_vote: 1,
          position: 1,
        },
      };

      return Promise.resolve(
        mockResponse({
          body: JSON.stringify(sharedList),
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });

  renderWithAuth(
    <SharedList />,
    {
      id: 2,
      username: 'friendfan',
      email: 'friend@example.com',
    }
  );

  expect(await screen.findByRole('heading', { name: /movie night/i })).toBeInTheDocument();
  const consensusHeading = screen.getByRole('heading', { name: /current consensus/i });
  const consensusCard = consensusHeading.closest('section');
  expect(consensusCard).not.toBeNull();
  expect(within(consensusCard).getByRole('heading', { name: 'Arrival' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /upvote dune/i }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/lists/7/items/101/vote',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ value: 1 }),
      })
    );
  });

  await waitFor(() => {
    expect(within(consensusCard).getByRole('heading', { name: 'Dune' })).toBeInTheDocument();
  });
});
