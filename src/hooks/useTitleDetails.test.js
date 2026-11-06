import { fetchTitleLogo, mayHaveTitleLogo } from './useTitleDetails';
import { tmdbGet } from '../utils/tmdb';

jest.mock('../utils/tmdb', () => ({ ...jest.requireActual('../utils/tmdb'), tmdbGet: jest.fn() }));

beforeEach(() => tmdbGet.mockReset());

test('a movie row that also carries an IMDb id is looked up by its TMDB id', async () => {
  tmdbGet.mockResolvedValue({ images: { logos: [
    { iso_639_1: 'fr', file_path: '/fr.png', vote_average: 9 },
    { iso_639_1: 'en', file_path: '/en-low.png', vote_average: 2 },
    { iso_639_1: 'en', file_path: '/en.png', vote_average: 5 },
  ] } });
  const item = { id: 275556, media_type: 'movie', source_key: 'tmdb:movie:1423191', imdb_id: 'tt35538033' };
  expect(mayHaveTitleLogo(item)).toBe(true);
  await expect(fetchTitleLogo(item)).resolves.toMatch(/\/w500\/en\.png$/);
  // The popup's own request, so opening the popup afterwards is cached.
  expect(tmdbGet).toHaveBeenCalledWith('/movie/1423191', expect.objectContaining({ include_image_language: 'en,null' }));
  expect(tmdbGet.mock.calls[0][1].append_to_response).toContain('images');
});

test('books, untracked titles and TMDB failures have no logo (the title shows as text)', async () => {
  expect(mayHaveTitleLogo({ id: 1, media_type: 'book' })).toBe(false);
  expect(mayHaveTitleLogo({ id: 2, media_type: 'movie', imdb_id: 'tt1' })).toBe(false);
  await expect(fetchTitleLogo({ id: 1, media_type: 'book' })).resolves.toBeNull();
  tmdbGet.mockResolvedValue(null);
  await expect(fetchTitleLogo({ id: 3, media_type: 'tv_show', source_key: 'tmdb:tv:62643' })).resolves.toBeNull();
  tmdbGet.mockResolvedValue({ images: { logos: [] } });
  await expect(fetchTitleLogo({ id: 3, media_type: 'tv_show', source_key: 'tmdb:tv:62643' })).resolves.toBeNull();
});
