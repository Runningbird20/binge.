import { parseCsv, parseImport } from './historyImport';

jest.mock('./tmdb', () => ({ normalizeTmdbResult: jest.fn(), tmdbGet: jest.fn() }));
jest.mock('./catalogLookup', () => ({ resolveTmdbItems: jest.fn() }));
jest.mock('./supabase', () => ({ supabase: null }));
jest.mock('../components/RatingArtifact', () => ({ buildUniformCategories: jest.fn() }));

describe('parseCsv', () => {
  it('handles quotes, commas and escaped quotes', () => {
    const rows = parseCsv('Name,Year\r\n"Crouching Tiger, Hidden Dragon",2000\n"The ""Real"" Thing",1999\n');
    expect(rows).toEqual([{ Name: 'Crouching Tiger, Hidden Dragon', Year: '2000' }, { Name: 'The "Real" Thing', Year: '1999' }]);
  });
});

describe('parseImport', () => {
  it('reads a Letterboxd export (ratings beat watched, diary dates kept)', () => {
    const { records, sources } = parseImport([
      { name: 'watched.csv', text: 'Date,Name,Year,Letterboxd URI\n2024-01-02,Arrival,2016,https://boxd.it/a\n2024-02-03,Heat,1995,https://boxd.it/h\n' },
      { name: 'ratings.csv', text: 'Date,Name,Year,Letterboxd URI,Rating\n2024-01-03,Arrival,2016,https://boxd.it/a,4.5\n' },
      { name: 'watchlist.csv', text: 'Date,Name,Year,Letterboxd URI\n2024-03-01,Dune,2021,https://boxd.it/d\n' },
    ]);
    expect(sources).toEqual(['Letterboxd']);
    const byTitle = Object.fromEntries(records.map((r) => [r.title, r]));
    expect(byTitle.Arrival).toMatchObject({ kind: 'movie', year: 2016, rating: 4.5, list: 'rated' });
    expect(byTitle.Heat).toMatchObject({ list: 'watched' });
    expect(byTitle.Dune).toMatchObject({ list: 'watchlist' });
  });

  it('reads IMDb ratings (10-point → half stars, TV vs movie, skips episodes)', () => {
    const csv = 'Const,Your Rating,Date Rated,Title,Title Type,Year\n'
      + 'tt2543164,9,2024-01-01,Arrival,Movie,2016\n'
      + 'tt0903747,10,2024-01-02,Breaking Bad,TV Series,2008\n'
      + 'tt2301451,10,2024-01-03,Ozymandias,TV Episode,2013\n'
      + 'tt0113277,1,2024-01-04,Heat,movie,1995\n';
    const { records } = parseImport([{ name: 'ratings.csv', text: csv }]);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ imdbId: 'tt2543164', kind: 'movie', rating: 4.5 });
    expect(records[1]).toMatchObject({ kind: 'tv', rating: 5 });
    expect(records[2].rating).toBe(1); // 0.5★ floors to binge.'s minimum of 1
  });

  it('reads Trakt JSON (ids, ratings, watched shows)', () => {
    const { records, sources } = parseImport([
      { name: 'ratings-movies.json', text: JSON.stringify([{ rating: 8, rated_at: '2024-05-01T00:00:00Z', movie: { title: 'Heat', year: 1995, ids: { tmdb: 949, imdb: 'tt0113277' } } }]) },
      { name: 'watched-shows.json', text: JSON.stringify([{ last_watched_at: '2024-06-01T00:00:00Z', plays: 10, show: { title: 'The Bear', year: 2022, ids: { tmdb: 136315 } } }]) },
    ]);
    expect(sources).toEqual(['Trakt']);
    expect(records[0]).toMatchObject({ tmdbId: 949, rating: 4, list: 'rated', kind: 'movie' });
    expect(records[1]).toMatchObject({ tmdbId: 136315, list: 'watching', kind: 'tv' });
  });

  it('reads Netflix viewing history (episodes collapse to one show)', () => {
    const csv = 'Title,Date\n'
      + '"Stranger Things: Season 4: Chapter One",5/27/24\n'
      + '"Stranger Things: Season 4: Chapter Two",5/28/24\n'
      + '"The Queen\'s Gambit: Limited Series: Openings",1/2/24\n'
      + '"Glass Onion: A Knives Out Mystery",12/24/23\n';
    const { records, sources } = parseImport([{ name: 'NetflixViewingHistory.csv', text: csv }]);
    expect(sources).toEqual(['Netflix']);
    expect(records.map((r) => [r.title, r.kind])).toEqual([
      ['Stranger Things', 'tv'],
      ["The Queen's Gambit", 'tv'],
      ['Glass Onion: A Knives Out Mystery', 'unknown'],
    ]);
  });
});
