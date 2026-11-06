import { fireEvent, render, screen } from '@testing-library/react';
import MangaTab from './MangaTab';
import { getProvider } from '../utils/mangaProviders';
import { findWhereToRead } from '../utils/anilist';
import { upsertMangaListItem } from '../utils/mangaLibrary';

jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true });
jest.mock('../utils/mangaProviders', () => {
  const provider = {
    key: 'mangadex',
    label: 'MangaDex',
    tagline: 'Read right here in binge.',
    reading: 'in-app',
    rows: [{ id: 'popular', title: 'Popular now', load: jest.fn() }],
    popular: jest.fn(),
    search: jest.fn(),
    getChapters: jest.fn(),
    readLinks: () => [],
  };
  return { DEFAULT_PROVIDER: 'mangadex', PROVIDER_LIST: [provider], getProvider: () => provider, providerFor: () => provider };
});
jest.mock('../utils/anilist', () => ({ findWhereToRead: jest.fn() }));

const SERIES = { id: 'op', provider: 'mangadex', title: 'One Piece', author: 'Eiichiro Oda', cover: null, tags: ['Adventure'], description: 'Pirates.' };
const ROW = [SERIES, ...['Berserk', 'Monster', 'Vagabond'].map((title) => ({ ...SERIES, id: title.toLowerCase(), title }))];
const provider = getProvider();

// Implementations go here, not in jest.mock: CRA's Jest config resets mocks before each test.
beforeEach(() => {
  window.localStorage.clear();
  provider.popular.mockResolvedValue([SERIES]);
  provider.rows[0].load.mockResolvedValue(ROW);
  provider.search.mockResolvedValue([]);
  provider.getChapters.mockResolvedValue([{ id: 'c1', number: '1', title: 'Romance Dawn' }]);
  findWhereToRead.mockResolvedValue([]);
});

// A smoke test for the tab and the pieces in components/manga/ (row card, chapter popup):
// a series in a row opens with its chapters.
test('a series in a row opens with its chapters', async () => {
  render(<MangaTab />);
  fireEvent.click(await screen.findByRole('button', { name: /One Piece/ }));
  expect(await screen.findByRole('heading', { name: 'One Piece' })).toBeInTheDocument();
  expect(await screen.findAllByText('Romance Dawn')).not.toHaveLength(0);
  expect(provider.getChapters).toHaveBeenCalledWith(expect.objectContaining({ id: 'op' }), expect.anything());
});

test('series saved to the list show under Continue Reading', async () => {
  upsertMangaListItem(SERIES, 'reading');
  render(<MangaTab />);
  expect(await screen.findByRole('region', { name: 'Continue Reading' })).toBeInTheDocument();
});
