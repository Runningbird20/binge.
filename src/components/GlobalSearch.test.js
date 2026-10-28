import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GlobalSearch from './GlobalSearch';
jest.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/home' }), useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('@phosphor-icons/react', () => new Proxy({}, { get: () => () => null }));
jest.mock('../api', () => ({ api: { get: jest.fn().mockResolvedValue({}) } }));
jest.mock('../utils/searchExtras', () => ({
  getRecentSearches: () => [], groupResults: () => ({ top: null, movies: [], series: [], books: [] }),
  addRecentSearch: jest.fn(), clearRecentSearches: jest.fn(), removeRecentSearch: jest.fn(),
  searchGames: jest.fn().mockResolvedValue([]), searchPerson: jest.fn().mockResolvedValue(null),
}));
jest.mock('../utils/imageQuality', () => ({ posterSrc: (url) => url }));
test('header search expands on click, focuses input, and collapses with Escape', async () => {
  render(<GlobalSearch />);
  const input = screen.getByRole('searchbox');
  expect(input).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.change(input, { target: { value: 'Alien' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toBeDisabled();
  expect(input).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Open search' })).toHaveFocus();
});
