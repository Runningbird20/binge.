import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExpandableSearch from './ExpandableSearch';
jest.mock('@phosphor-icons/react', () => ({ MagnifyingGlass: () => null, X: () => null }));
function Search() {
  const [value, setValue] = useState('');
  return <ExpandableSearch value={value} onChange={setValue} label="Search movies" />;
}
test('expands, focuses the field, and clears and collapses on Escape', async () => {
  render(<Search />);
  const toggle = screen.getByRole('button', { name: 'Search movies' });
  const input = screen.getByRole('searchbox');
  expect(input).toBeDisabled();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.change(input, { target: { value: 'Alien' } });
  expect(input).toHaveValue('Alien');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(input).toHaveValue('');
  expect(input).toBeDisabled();
  expect(toggle).toHaveFocus();
});
