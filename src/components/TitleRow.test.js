import { act, render, screen } from '@testing-library/react';
import * as supabaseData from '../utils/supabaseData';
import { resetWatchedKeys } from '../utils/watchedTitles';
import TitleRow from './TitleRow';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });

const items = Array.from({ length: 12 }, (_, index) => ({ media_type: 'movie', id: index + 1, title: `Movie ${index + 1}` }));
const renderItem = (item) => <span>{item.title}</span>;
const shown = () => screen.queryAllByText(/^Movie \d+$/).map((node) => node.textContent);

afterEach(() => {
  jest.restoreAllMocks();
  resetWatchedKeys();
});

test('a recommendation row leaves out watched titles, then fills its limit', async () => {
  jest.spyOn(supabaseData, 'fetchWatchedTitleKeys').mockResolvedValue(new Set(['movie:1', 'movie:3']));
  render(<TitleRow title="Top 10" items={items} limit={10} hideWatched renderItem={renderItem} />);
  // Nothing shows until it's known what's been watched.
  expect(shown()).toEqual([]);
  expect(await screen.findByText('Movie 2')).toBeTruthy();
  expect(shown()).toEqual(['Movie 2', 'Movie 4', 'Movie 5', 'Movie 6', 'Movie 7', 'Movie 8', 'Movie 9', 'Movie 10', 'Movie 11', 'Movie 12']);
});

test('marking something watched takes it out of the row straight away', async () => {
  jest.spyOn(supabaseData, 'fetchWatchedTitleKeys')
    .mockResolvedValueOnce(new Set())
    .mockResolvedValueOnce(new Set(['movie:2']));
  render(<TitleRow title="Popular" items={items.slice(0, 3)} hideWatched renderItem={renderItem} />);
  expect(await screen.findByText('Movie 2')).toBeTruthy();
  await act(async () => { window.dispatchEvent(new CustomEvent('binge:historyChanged')); });
  expect(shown()).toEqual(['Movie 1', 'Movie 3']);
});

test('other rows (Continue Watching, My List…) keep every title', () => {
  const fetch = jest.spyOn(supabaseData, 'fetchWatchedTitleKeys');
  render(<TitleRow title="My List" items={items.slice(0, 2)} renderItem={renderItem} />);
  expect(shown()).toEqual(['Movie 1', 'Movie 2']);
  expect(fetch).not.toHaveBeenCalled();
});
