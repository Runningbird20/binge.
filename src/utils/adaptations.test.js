import { findAdaptations, splitBookTitle } from './adaptations';
import { resolveTmdbItems } from './catalogLookup';
import { searchTmdbMulti, tmdbGet } from './tmdb';

jest.mock('./supabase', () => ({ requireSupabaseClient: jest.fn() }));
jest.mock('./catalogLookup', () => ({ resolveTmdbItems: jest.fn() }));
jest.mock('./tmdb', () => ({
  searchTmdbMulti: jest.fn(),
  tmdbGet: jest.fn(),
  tmdbKind: (mediaType) => (mediaType === 'tv_show' ? 'tv' : 'movie'),
}));

describe('splitBookTitle', () => {
  it('separates Goodreads series info from the title', () => {
    expect(splitBookTitle('Dune (Dune, #1)')).toEqual({ main: 'Dune', series: 'Dune', number: 1 });
    expect(splitBookTitle('Children of Dune (Dune #3)')).toEqual({ main: 'Children of Dune', series: 'Dune', number: 3 });
    expect(splitBookTitle('A Game of Thrones (A Song of Ice and Fire, #1)')).toEqual({ main: 'A Game of Thrones', series: 'A Song of Ice and Fire', number: 1 });
  });

  it('leaves standalone titles alone', () => {
    expect(splitBookTitle('The Martian')).toEqual({ main: 'The Martian', series: '', number: null });
    expect(splitBookTitle('Fire & Blood (Targaryen History)')).toEqual({ main: 'Fire & Blood (Targaryen History)', series: '', number: null });
  });
});

describe('findAdaptations', () => {
  it('only offers adaptations within the profile’s maturity level', async () => {
    searchTmdbMulti.mockResolvedValue([{ mediaType: 'movie', tmdbId: 7, title: 'Dune' }]);
    tmdbGet.mockResolvedValue({ credits: { crew: [{ job: 'Novel', name: 'Frank Herbert' }] } });
    resolveTmdbItems.mockResolvedValue([]);
    await findAdaptations({ title: 'Dune (Dune, #1)', author: 'Frank Herbert' }, { kidsSafe: 'kids' });
    expect(resolveTmdbItems).toHaveBeenCalledWith([expect.objectContaining({ tmdbId: 7 })], 'movie', { kidsSafe: 'kids' });
    expect(resolveTmdbItems).toHaveBeenCalledWith([], 'tv_show', { kidsSafe: 'kids' });
  });
});
