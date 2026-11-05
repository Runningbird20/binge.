// Search page filters (/search): type, decade and language chips that narrow
// every result on the page — title matches, the person row, "More like…",
// related rows and Ask binge. picks. Kept in the URL (?type=&decade=&lang=)
// so Back and refresh keep them.
import { languageName } from './tmdb';

export const FILTER_KEYS = ['type', 'decade', 'lang'];

const TYPES = [
  { value: 'movie', label: 'Movies' },
  { value: 'tv_show', label: 'Series' },
  { value: 'book', label: 'Books' },
];
const OLDEST_DECADE = 1970; // earlier years share one "Before 1970" chip
const MAX_LANGUAGES = 8;

export function readFilters(searchParams) {
  return {
    type: searchParams.get('type') || '',
    decade: searchParams.get('decade') || '',
    lang: searchParams.get('lang') || '',
  };
}

export function hasFilters(filters) {
  return FILTER_KEYS.some((key) => Boolean(filters?.[key]));
}

// Results come tagged either way: media_type ('tv_show') or _type ('tv').
export function mediaTypeOf(item) {
  if (item?.media_type) return item.media_type;
  return { movie: 'movie', tv: 'tv_show', book: 'book' }[item?._type] || '';
}

export function itemYear(item) {
  const year = Number(item?.year) || Number(String(item?.release_date || item?.first_air_date || '').slice(0, 4));
  return year > 1800 && year < 3000 ? year : null;
}

// '2010' for 2014, 'earlier' before 1970, '' when the year is unknown.
export function decadeOf(item) {
  const year = itemYear(item);
  if (!year) return '';
  return year < OLDEST_DECADE ? 'earlier' : String(Math.floor(year / 10) * 10);
}

export function itemLanguage(item) {
  return item?.original_language || item?._tmdb?.originalLanguage || '';
}

// Items that pass the chosen filters. A title whose year or language isn't
// known doesn't pass a decade or language filter.
export function filterItems(items, filters) {
  if (!hasFilters(filters)) return items || [];
  return (items || []).filter((item) => (!filters.type || mediaTypeOf(item) === filters.type)
    && (!filters.decade || decadeOf(item) === filters.decade)
    && (!filters.lang || itemLanguage(item) === filters.lang));
}

// The chips worth showing for these results: each list leads with its "any"
// chip; a list only appears when the results actually differ on it (or a
// filter is set on it). The chosen value always stays, even with no results.
// Counts follow the other two filters, so a chip never leads nowhere.
export function filterOptions(items, filters = {}) {
  const pool = (key) => filterItems(items, { ...filters, [key]: '' });

  const count = (list, read) => {
    const counts = new Map();
    list.forEach((item) => {
      const value = read(item);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    });
    return counts;
  };
  const keep = (counts, chosen) => {
    if (chosen && !counts.has(chosen)) counts.set(chosen, 0);
    return counts;
  };

  const types = keep(count(pool('type'), mediaTypeOf), filters.type);
  const decades = keep(count(pool('decade'), decadeOf), filters.decade);
  const languages = keep(count(pool('lang'), itemLanguage), filters.lang);

  const typeOptions = TYPES.filter((type) => types.has(type.value)).map((type) => ({ ...type, count: types.get(type.value) }));
  const decadeValue = (value) => (value === 'earlier' ? 0 : Number(value));
  const decadeOptions = [...decades.entries()]
    .sort(([a], [b]) => decadeValue(b) - decadeValue(a)) // newest first
    .map(([value, total]) => ({ value, label: value === 'earlier' ? `Before ${OLDEST_DECADE}` : `${value}s`, count: total }));
  const languageOptions = [...languages.entries()]
    .sort((a, b) => b[1] - a[1] || languageName(a[0]).localeCompare(languageName(b[0])))
    .filter(([value], index) => index < MAX_LANGUAGES || value === filters.lang)
    .map(([value, total]) => ({ value, label: languageName(value), count: total }));

  const worth = (options, chosen) => (chosen ? options : options.length > 1 ? options : []);
  return {
    type: worth(typeOptions, filters.type),
    decade: worth(decadeOptions, filters.decade),
    lang: worth(languageOptions, filters.lang),
  };
}
