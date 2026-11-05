import { strFromU8, unzipSync } from 'fflate';
import { buildExport, exportFilename, letterboxdFiles, summarizeExport, toCsv, zipExport } from './dataExport';
import { parseCsv, parseImport } from './historyImport';

// Rows as fetchExportData returns them (catalog-enriched Supabase rows).
const RAW = {
  ratings: [
    { media_type: 'movie', media_id: 11, title: 'Arrival', year: 2016, source_key: 'tmdb:movie:329865', acting: 4, writing: 5, originality: 4, pacing: 4, cinematography: 5, created_at: '2026-03-02T10:00:00Z' },
    { media_type: 'tv_show', media_id: 22, title: 'The Bear', year: 2022, source_key: 'tmdb:tv:136315', premise: 5, originality: 5, acting: 5, cinematography: 4, writing: 5, pacing: 4, resonance: 5, created_at: '2026-04-01T10:00:00Z' },
    { media_type: 'book', media_id: 33, title: 'Dune', year: 1965, prose: 4, plot: 5, characters: 4, originality: 5, pacing: 3, resonance: 5, created_at: '2026-05-01T10:00:00Z' },
  ],
  list: [
    { media_type: 'movie', media_id: 44, title: 'Heat, Director’s "Cut"', year: 1995, source_key: 'tmdb:movie:949', status: 'watched', added_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-06T00:00:00Z' },
    { media_type: 'movie', media_id: 55, title: 'Dune: Part Two', year: 2024, source_key: 'tmdb:movie:693134', status: 'plan_to_watch', added_at: '2026-02-01T00:00:00Z' },
    { media_type: 'movie', media_id: 11, title: 'Arrival', year: 2016, source_key: 'tmdb:movie:329865', status: 'plan_to_watch', added_at: '2025-12-01T00:00:00Z' },
    { media_type: 'tv_show', media_id: 66, title: 'Severance', year: 2022, source_key: 'tmdb:tv:95396', status: 'watching', current_season: 2, current_episode: 3, added_at: '2026-02-10T00:00:00Z' },
  ],
  history: [
    { media_type: 'tv_show', media_id: 66, title: 'Severance', year: 2022, source_key: 'tmdb:tv:95396', current_season: 2, current_episode: 3, position_seconds: 1200, duration_seconds: 3000, updated_at: '2026-06-01T20:00:00Z' },
  ],
  episodes: [
    { media_type: 'tv_show', media_id: 66, title: 'Severance', year: 2022, source_key: 'tmdb:tv:95396', season: 2, episode: 2, watched_at: '2026-05-30T20:00:00Z' },
  ],
};
const NOW = new Date('2026-11-05T12:00:00Z');

test('builds the JSON with stars, categories, progress and TMDB ids', () => {
  const data = buildExport(RAW, { profileName: 'Cristal', now: NOW });
  expect(data).toMatchObject({ format: 'binge-export', version: 1, profile: 'Cristal', exported_at: '2026-11-05T12:00:00.000Z' });
  expect(data.ratings[0]).toMatchObject({ type: 'movie', title: 'Arrival', tmdb_id: 329865, binge_id: 11, stars: 4.4, rated_at: '2026-03-02T10:00:00Z' });
  expect(data.ratings[0].categories).toEqual({ acting: 4, writing: 5, originality: 4, pacing: 4, cinematography: 5 });
  expect(data.ratings[2]).toMatchObject({ type: 'book', tmdb_id: null });
  expect(data.my_list[3]).toMatchObject({ type: 'tv', status: 'watching', progress: { season: 2, episode: 3, page: null, chapter: null } });
  expect(data.history[0]).toMatchObject({ type: 'tv', position_seconds: 1200, last_watched_at: '2026-06-01T20:00:00Z' });
  expect(data.episodes[0]).toMatchObject({ title: 'Severance', season: 2, episode: 2 });
  expect(summarizeExport(data)).toBe('3 ratings · 4 on My List · 1 in history · 1 episode');
});

test('Letterboxd CSVs hold films only, in Letterboxd’s columns, with half stars', () => {
  const files = letterboxdFiles(buildExport(RAW, { now: NOW }));
  const ratings = parseCsv(files['ratings.csv']);
  expect(Object.keys(ratings[0])).toEqual(['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'tmdbID']);
  expect(ratings).toEqual([{ Date: '2026-03-02', Name: 'Arrival', Year: '2016', 'Letterboxd URI': '', Rating: '4.5', tmdbID: '329865' }]);
  // Rated films count as watched; quotes and commas in titles survive.
  expect(parseCsv(files['watched.csv']).map((row) => row.Name)).toEqual(['Arrival', 'Heat, Director’s "Cut"']);
  // Already rated films don't sit on the watchlist too; series never do.
  expect(parseCsv(files['watchlist.csv']).map((row) => row.Name)).toEqual(['Dune: Part Two']);
});

test('the zip loads back in through /import with ratings and My List intact', () => {
  const entries = unzipSync(zipExport(buildExport(RAW, { now: NOW })));
  expect(Object.keys(entries).sort()).toEqual(['binge-data.json', 'letterboxd/ratings.csv', 'letterboxd/watched.csv', 'letterboxd/watchlist.csv']);
  const files = Object.entries(entries).map(([name, bytes]) => ({ name, text: strFromU8(bytes) }));

  const { records, sources } = parseImport(files);
  expect(sources).toEqual(['binge.']); // its Letterboxd copies aren't counted twice
  const byTitle = Object.fromEntries(records.map((record) => [`${record.title}|${record.list}`, record]));
  expect(byTitle['Arrival|rated']).toMatchObject({ kind: 'movie', tmdbId: 329865, rating: 4.5 });
  // 4.7★ (its category average) comes back at the importer's half-star precision.
  expect(byTitle['The Bear|rated']).toMatchObject({ kind: 'tv', tmdbId: 136315, rating: 4.5 });
  expect(byTitle['Severance|watching']).toMatchObject({ kind: 'tv', tmdbId: 95396 });
  expect(byTitle['Dune: Part Two|watchlist']).toMatchObject({ kind: 'movie', tmdbId: 693134 });
  expect(records.some((record) => record.title === 'Dune' && record.kind === 'book')).toBe(false);

  // Just the Letterboxd CSVs work on their own too (as from Letterboxd).
  const lbOnly = parseImport(files.filter(({ name }) => name.startsWith('letterboxd/')));
  expect(lbOnly.sources).toEqual(['Letterboxd']);
  expect(lbOnly.records.find((record) => record.title === 'Arrival')).toMatchObject({ tmdbId: 329865, rating: 4.5, list: 'rated' });
});

test('file names and CSV cells are safe', () => {
  expect(exportFilename('Zoë & Kids', NOW)).toBe('binge-export-zoe-kids-2026-11-05.zip');
  expect(exportFilename('', NOW)).toBe('binge-export-profile-2026-11-05.zip');
  expect(toCsv(['A'], [{ A: 'line\nbreak' }, { A: null }])).toBe('A\n"line\nbreak"\n\n');
});
