import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Signup from './pages/Signup';
import Home from './pages/Home';
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
