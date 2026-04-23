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

  test('shows the locked landing posters and names', () => {
    render(<Landing />);

    expect(screen.getByRole('img', { name: /project hail mary poster/i })).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w500/yihdXomYb5kTeSivtFndMy5iDmf.jpg'
    );
    expect(screen.getByRole('img', { name: /sofia the first poster/i })).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w500/eZHmUO1OQRpVkAOdj9VwYCCyQew.jpg'
    );
    expect(screen.getByRole('img', { name: /criminal minds poster/i })).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w500/gigxjNnACiXAfrwoMox5WJFgc0I.jpg'
    );
    expect(screen.getByRole('img', { name: /indiana jones and the dial of destiny poster/i })).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w500/Af4bXE63pVsb2FtbW8uYIyPBadD.jpg'
    );

    expect(screen.getByText('Project Hail Mary')).toBeInTheDocument();
    expect(screen.getByText('Sofia the First')).toBeInTheDocument();
    expect(screen.getByText('Criminal Minds')).toBeInTheDocument();
    expect(screen.getByText('Indiana Jones and the Dial of Destiny')).toBeInTheDocument();
  });
});
