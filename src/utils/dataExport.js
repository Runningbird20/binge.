// "Download my data" (Profile page): the active profile's ratings, My List,
// watch history and episode progress, zipped as
//   binge-data.json           everything, including series, books and episodes
//   letterboxd/ratings.csv    films only, in Letterboxd's export format (plus
//   letterboxd/watched.csv    tmdbID), so they also import into Letterboxd
//   letterboxd/watchlist.csv
// The zip loads back in through /import: historyImport.js reads the JSON as a
// binge. export (ratings + My List for films and series).
import { strToU8, zipSync } from 'fflate';
import { RATING_TABLES, enrichMediaRecords, getAuthenticatedUser, requireSupabase, scopeToProfile } from './data/shared';
import { getActiveProfileId } from './activeProfile';
import { computeStarRating } from '../components/RatingArtifact';
import { tmdbIdFromItem } from './tmdb';

export const EXPORT_FORMAT = 'binge-export';
const EXPORT_VERSION = 1;
const PAGE = 1000; // Supabase returns at most 1000 rows per request
const ENRICH_BATCH = 400; // catalog lookups answer up to 1000 rows
const TYPE = { movie: 'movie', tv_show: 'tv', book: 'book' };

// ── Reading ────────────────────────────────────────────────────────────

async function fetchAll(buildQuery, what) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn’t read your ${what}. Try again in a moment.`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function enrichAll(records) {
  const out = [];
  for (let i = 0; i < records.length; i += ENRICH_BATCH) {
    // eslint-disable-next-line no-await-in-loop
    out.push(...(await enrichMediaRecords(records.slice(i, i + ENRICH_BATCH))));
  }
  return out;
}

// Everything the export holds, for the active profile (the same scope the
// Profile page shows; the default profile also owns rows with no profile).
export async function fetchExportData() {
  const client = requireSupabase();
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) throw new Error('Sign in again to download your data.');
  const profileId = getActiveProfileId();
  const scoped = (query) => (profileId ? scopeToProfile(query, profileId) : query);

  const ratingGroups = await Promise.all(Object.entries(RATING_TABLES).map(async ([mediaType, schema]) => {
    const rows = await fetchAll(() => scoped(client.from(schema.table)
      .select(['id', 'media_id', ...schema.columns, 'created_at'].join(', '))
      .eq('user_id', user.id)
      .order('id', { ascending: true })), 'ratings');
    return rows.map((row) => ({ ...row, media_type: mediaType }));
  }));

  const [list, history, episodes] = await Promise.all([
    fetchAll(() => scoped(client.from('watchlist')
      .select('id, media_type, media_id, status, added_at, current_season, current_episode, current_page, current_chapter, updated_at')
      .eq('user_id', user.id)
      .order('id', { ascending: true })), 'list'),
    fetchAll(() => scoped(client.from('continue_watching')
      .select('id, media_type, media_id, current_season, current_episode, current_page, current_chapter, position_seconds, duration_seconds, updated_at')
      .eq('user_id', user.id)
      .order('id', { ascending: true })), 'watch history'),
    fetchAll(() => scoped(client.from('episode_progress')
      .select('media_id, season, episode, watched_at')
      .eq('user_id', user.id)
      .order('watched_at', { ascending: true })
      .order('media_id', { ascending: true })
      .order('season', { ascending: true })
      .order('episode', { ascending: true })), 'episode progress'),
  ]);

  return {
    ratings: await enrichAll(ratingGroups.flat()),
    list: await enrichAll(list),
    history: await enrichAll(history),
    episodes: await enrichAll(episodes.map((row) => ({ ...row, media_type: 'tv_show' }))),
  };
}

// ── Building (pure) ────────────────────────────────────────────────────

function title(record) {
  return {
    type: TYPE[record.media_type] || record.media_type,
    title: record.title || null,
    year: record.year ?? null,
    tmdb_id: record.media_type === 'book' ? null : tmdbIdFromItem(record),
    binge_id: Number(record.media_id),
  };
}

const progressOf = (row) => {
  const progress = {
    season: row.current_season ?? null,
    episode: row.current_episode ?? null,
    page: row.current_page ?? null,
    chapter: row.current_chapter ?? null,
  };
  return Object.values(progress).some((value) => value != null) ? progress : null;
};

export function buildExport({ ratings = [], list = [], history = [], episodes = [] }, { profileName = null, now = new Date() } = {}) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: now.toISOString(),
    profile: profileName,
    ratings: ratings.map((row) => {
      const schema = RATING_TABLES[row.media_type];
      return {
        ...title(row),
        stars: computeStarRating(row.media_type, row),
        categories: schema ? Object.fromEntries(schema.columns.map((column) => [column, row[column] ?? null])) : {},
        rated_at: row.created_at || null,
      };
    }),
    my_list: list.map((row) => ({
      ...title(row),
      status: row.status,
      added_at: row.added_at || null,
      updated_at: row.updated_at || null,
      progress: progressOf(row),
    })),
    history: history.map((row) => ({
      ...title(row),
      last_watched_at: row.updated_at || null,
      progress: progressOf(row),
      position_seconds: row.position_seconds ?? null,
      duration_seconds: row.duration_seconds ?? null,
    })),
    episodes: episodes.map((row) => ({
      ...title(row),
      season: row.season,
      episode: row.episode,
      watched_at: row.watched_at || null,
    })),
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns, rows) {
  return [columns, ...rows.map((row) => columns.map((column) => row[column]))]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\n') + '\n';
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
const halfStar = (stars) => (stars > 0 ? Math.min(5, Math.max(0.5, Math.round(stars * 2) / 2)) : '');

// Letterboxd's export columns (ratings/watched/watchlist), films only, plus
// tmdbID so a re-import matches each film exactly.
export function letterboxdFiles(data) {
  const films = (rows) => rows.filter((row) => row.type === 'movie');
  const lb = (row, date) => ({ Date: day(date), Name: row.title, Year: row.year ?? '', 'Letterboxd URI': '', tmdbID: row.tmdb_id ?? '' });

  const rated = films(data.ratings);
  const ratedIds = new Set(rated.map((row) => row.binge_id));
  const watched = new Map();
  rated.forEach((row) => watched.set(row.binge_id, lb(row, row.rated_at)));
  films(data.my_list).filter((row) => row.status === 'watched' && !watched.has(row.binge_id))
    .forEach((row) => watched.set(row.binge_id, lb(row, row.updated_at || row.added_at)));
  const watchlist = films(data.my_list).filter((row) => row.status === 'plan_to_watch' && !ratedIds.has(row.binge_id));

  return {
    'ratings.csv': toCsv(['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'tmdbID'],
      rated.map((row) => ({ ...lb(row, row.rated_at), Rating: halfStar(row.stars) }))),
    'watched.csv': toCsv(['Date', 'Name', 'Year', 'Letterboxd URI', 'tmdbID'], [...watched.values()]),
    'watchlist.csv': toCsv(['Date', 'Name', 'Year', 'Letterboxd URI', 'tmdbID'], watchlist.map((row) => lb(row, row.added_at))),
  };
}

export function exportFilename(profileName, now = new Date()) {
  const slug = String(profileName || 'profile').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profile';
  return `binge-export-${slug}-${now.toISOString().slice(0, 10)}.zip`;
}

export function zipExport(data) {
  const files = { 'binge-data.json': strToU8(JSON.stringify(data, null, 2)) };
  Object.entries(letterboxdFiles(data)).forEach(([name, text]) => { files[`letterboxd/${name}`] = strToU8(text); });
  return zipSync(files, { level: 6 });
}

export function summarizeExport(data) {
  const n = (count, one, many) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
  return [
    n(data.ratings.length, 'rating', 'ratings'),
    `${data.my_list.length.toLocaleString()} on My List`,
    `${data.history.length.toLocaleString()} in history`,
    n(data.episodes.length, 'episode', 'episodes'),
  ].join(' · ');
}

// ── Saving ─────────────────────────────────────────────────────────────

function saveBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Fetches, builds and downloads the zip. → { filename, summary }
export async function downloadMyData({ profileName = null } = {}) {
  const now = new Date();
  const data = buildExport(await fetchExportData(), { profileName, now });
  const filename = exportFilename(profileName, now);
  saveBytes(zipExport(data), filename);
  return { filename, summary: summarizeExport(data) };
}
