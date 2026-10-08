import { groupResults, matchesPersonName } from './searchExtras';

jest.mock('./tmdb', () => ({ normalizeTmdbResult: jest.fn(), tmdbGet: jest.fn(), tmdbImage: jest.fn() }));
jest.mock('./catalogLookup', () => ({ resolveTmdbItems: jest.fn() }));
jest.mock('./sportsProviders', () => ({ fetchSportsStreams: jest.fn(() => Promise.resolve([])) }));

describe('groupResults', () => {
  it('pulls the single best match out as the top result', () => {
    const grouped = groupResults({
      movies: [{ id: 1, title: 'Dune', relevance: 0.6 }, { id: 2, title: 'Dune: Part Two', relevance: 0.9 }],
      tv: [{ id: 3, title: 'Dune: Prophecy', relevance: 0.7 }],
      books: [{ id: 4, title: 'Dune', relevance: 0.8 }],
    });
    expect(grouped.top).toMatchObject({ id: 2, media_type: 'movie' });
    expect(grouped.movies.map((m) => m.id)).toEqual([1]);
    expect(grouped.series[0].media_type).toBe('tv_show');
    expect(grouped.books[0].media_type).toBe('book');
  });

  it('handles no results', () => {
    expect(groupResults(null)).toEqual({ top: null, movies: [], series: [], books: [] });
  });
});

describe('matchesPersonName', () => {
  it('matches full names and surnames', () => {
    expect(matchesPersonName('tom hanks', 'Tom Hanks')).toBe(true);
    expect(matchesPersonName('nolan', 'Christopher Nolan')).toBe(true);
    expect(matchesPersonName('zendaya', 'Zendaya')).toBe(true);
  });
  it('ignores title-like queries', () => {
    expect(matchesPersonName('the bear', 'Tom Hanks')).toBe(false);
    expect(matchesPersonName('to', 'Tom Hanks')).toBe(false);
  });
});
