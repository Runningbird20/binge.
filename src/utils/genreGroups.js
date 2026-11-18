// Collapses the catalog's raw genre facets into fewer, broader chips
// (e.g. Action + Adventure + Martial Arts -> "Action & Adventure") so the
// genre bar doesn't force a long horizontal scroll.
export const MOVIE_GENRE_GROUPS = [
  { label: 'Action & Adventure', match: ['Action', 'Adventure', 'Martial Arts'] },
  { label: 'Animation & Anime', match: ['Animation', 'Anime'] },
  { label: 'Comedy', match: ['Comedy'] },
  { label: 'Crime & Thriller', match: ['Crime', 'Mystery', 'Suspense', 'Thriller'] },
  { label: 'Documentary & News', match: ['Documentary', 'Biography', 'News'] },
  { label: 'Drama', match: ['Drama', 'Indie'] },
  { label: 'Family & Kids', match: ['Family', 'Children'] },
  { label: 'Fantasy & Sci-Fi', match: ['Fantasy', 'Science Fiction'] },
  { label: 'Horror', match: ['Horror'] },
  { label: 'Music & Musicals', match: ['Music', 'Musical'] },
  { label: 'Reality & Game Shows', match: ['Reality', 'Game Show'] },
  { label: 'Romance', match: ['Romance'] },
  { label: 'Sport', match: ['Sport'] },
  { label: 'War & History', match: ['War', 'History'] },
  { label: 'Western', match: ['Western'] },
  { label: 'Shorts & TV Movies', match: ['Short', 'TV Movie'] },
];

export const TV_GENRE_GROUPS = [
  { label: 'Action & Adventure', match: ['Action', 'Action & Adventure', 'Adventure'] },
  { label: 'Animation', match: ['Animation'] },
  { label: 'Comedy', match: ['Comedy'] },
  { label: 'Crime & Mystery', match: ['Crime', 'Mystery', 'Thriller'] },
  { label: 'Documentary & News', match: ['Documentary', 'News'] },
  { label: 'Drama', match: ['Drama'] },
  { label: 'Family & Kids', match: ['Family', 'Kids'] },
  { label: 'Fantasy & Sci-Fi', match: ['Fantasy', 'Sci-Fi & Fantasy', 'Science Fiction'] },
  { label: 'History & War', match: ['History', 'War & Politics'] },
  { label: 'Reality & Talk', match: ['Reality', 'Talk', 'Soap'] },
  { label: 'Romance', match: ['Romance'] },
  { label: 'Western', match: ['Western'] },
];

// Every catalog probe returns a fresh genre-facets array even when the
// content hasn't changed. Callers store facets in state that feeds the chip
// list, which the fetch effect depends on (indirectly) — replacing that
// state with a new-but-equal array on every fetch would retrigger the
// effect forever. This lets callers bail out of the state update instead.
export function sameGenreList(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => value === b[i]);
}

// Builds the chip list from whichever genre values the catalog actually has
// right now: known groups collapse into one chip, and anything left over
// (e.g. a brand-new genre added to the DB) still gets its own chip instead
// of silently disappearing.
export function buildGenreGroups(groupDefs, availableGenres) {
  const available = new Set(availableGenres);
  const used = new Set();
  const groups = [];

  for (const def of groupDefs) {
    const values = def.match.filter((value) => available.has(value));
    if (values.length > 0) {
      values.forEach((value) => used.add(value));
      groups.push({ label: def.label, values });
    }
  }

  for (const genreValue of availableGenres) {
    if (!used.has(genreValue)) {
      groups.push({ label: genreValue, values: [genreValue] });
    }
  }

  return groups;
}
