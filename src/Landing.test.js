import { render, screen } from '@testing-library/react';
import Landing from './pages/Landing';
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

jest.mock('./contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

describe('Landing', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({
      isAuthenticated: false,
      authLoading: false,
      user: null,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('shows the hero headline and create account / sign in actions', () => {
    render(<Landing />);

    expect(
      screen.getByRole('heading', { name: /everything you watch and read, in one place/i })
    ).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /create account/i })).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('link', { name: /^sign in$/i })).toHaveAttribute('href', '/login');
  });

  test('redirects an already-authenticated user away from the landing page', () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      authLoading: false,
      user: { id: 1, username: 'mediafan', userType: 'user' },
    });

    render(<Landing />);

    expect(screen.getByTestId('navigate')).toBeInTheDocument();
  });
});
