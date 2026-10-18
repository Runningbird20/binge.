// Import viewing history from Letterboxd, IMDb, Trakt and Netflix exports,
// so recommendations are good from day one instead of after weeks.
//
// 1. readImportFiles: ZIPs are unpacked in the browser (fflate); CSV/JSON
//    files are read as text. Nothing is uploaded anywhere.
// 2. parseImport: each file is recognised by its shape and turned into
//    records { kind, title, year, imdbId, tmdbId, rating (★ 0.5–5),
//    watchedAt, list: 'rated' | 'watched' | 'watching' | 'watchlist' }.
// 3. matchRecords: TMDB id → IMDb id (/find) → title + year search, then the
//    binge. catalog (only titles we can actually show are imported).
// 4. applyImport: ratings and My List rows, upserted in batches.
import { unzipSync, strFromU8 } from 'fflate';
import { normalizeTmdbResult, tmdbGet } from './tmdb';
import { resolveTmdbItems } from './catalogLookup';
import { supabase } from './supabase';
import { getActiveProfileId } from './activeProfile';
import { buildUniformCategories } from '../components/RatingArtifact';

// ── Reading ────────────────────────────────────────────────────────────

export async function readImportFiles(fileList) {
  const out = []; // { name, text }
  for (const file of [...fileList]) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) {
      // eslint-disable-next-line no-await-in-loop
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
      Object.entries(entries).forEach(([name, bytes]) => {
        if (/\.(csv|json)$/i.test(name) && !name.startsWith('__MACOSX')) out.push({ name, text: strFromU8(bytes) });
      });
    } else if (/\.(csv|json)$/i.test(lower)) {
      // eslint-disable-next-line no-await-in-loop
      out.push({ name: file.name, text: await file.text() });
    }
  }
  return out;
}

// RFC 4180-ish CSV: quoted fields, escaped quotes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((cell) => cell.trim());
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((key, index) => [key, (cells[index] ?? '').trim()])));
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function halfStars(value, outOf) {
  const n = Number(value);
  if (!(n > 0)) return null;
  const stars = outOf === 10 ? n / 2 : n;
  return Math.min(5, Math.max(1, Math.round(stars * 2) / 2));
}

// ── Parsing per service ────────────────────────────────────────────────

function parseLetterboxd(files) {
  const byKey = new Map();
  const keyOf = (row) => row['Letterboxd URI'] || `${row.Name}|${row.Year}`;
  const upsert = (row, patch) => {
    const key = keyOf(row);
    byKey.set(key, { source: 'letterboxd', kind: 'movie', title: row.Name, year: Number(row.Year) || null, ...(byKey.get(key) || {}), ...patch });
  };
  files.forEach(({ name, rows }) => {
    const base = name.split('/').pop().toLowerCase();
    if (base === 'watched.csv') rows.forEach((row) => upsert(row, { list: byKey.get(keyOf(row))?.list || 'watched', watchedAt: isoDate(row.Date) }));
    if (base === 'diary.csv') rows.forEach((row) => upsert(row, { watchedAt: isoDate(row['Watched Date'] || row.Date), ...(row.Rating ? { rating: halfStars(row.Rating, 5), list: 'rated' } : {}) }));
    if (base === 'ratings.csv') rows.forEach((row) => upsert(row, { rating: halfStars(row.Rating, 5), list: 'rated', ratedAt: isoDate(row.Date) }));
    if (base === 'watchlist.csv') rows.forEach((row) => { if (!byKey.has(keyOf(row))) upsert(row, { list: 'watchlist' }); });
  });
  return [...byKey.values()].filter((record) => record.list);
}

const IMDB_TV = new Set(['tvSeries', 'tvMiniSeries', 'TV Series', 'TV Mini Series']);
const IMDB_MOVIE = new Set(['movie', 'tvMovie', 'video', 'Movie', 'TV Movie', 'Video']);

function parseImdb(rows) {
  return rows
    .filter((row) => IMDB_TV.has(row['Title Type']) || IMDB_MOVIE.has(row['Title Type']))
    .map((row) => {
      const rating = halfStars(row['Your Rating'], 10);
      return {
        source: 'imdb',
        kind: IMDB_TV.has(row['Title Type']) ? 'tv' : 'movie',
        imdbId: row.Const,
        title: row.Title,
        year: Number(row.Year) || null,
        rating,
        ratedAt: isoDate(row['Date Rated'] || row.Created),
        list: rating ? 'rated' : 'watchlist',
      };
    });
}

function parseTrakt(name, items) {
  const base = name.split('/').pop().toLowerCase();
  return (Array.isArray(items) ? items : []).map((entry) => {
    const media = entry.movie || entry.show;
    if (!media) return null;
    const kind = entry.movie ? 'movie' : 'tv';
    const record = {
      source: 'trakt',
      kind,
      title: media.title,
      year: media.year || null,
      tmdbId: media.ids?.tmdb || null,
      imdbId: media.ids?.imdb || null,
    };
    if (entry.rating != null) return { ...record, rating: halfStars(entry.rating, 10), ratedAt: isoDate(entry.rated_at), list: 'rated' };
    if (base.includes('watchlist')) return { ...record, list: 'watchlist' };
    if (entry.last_watched_at || entry.watched_at || entry.plays) {
      return { ...record, watchedAt: isoDate(entry.last_watched_at || entry.watched_at), list: kind === 'tv' ? 'watching' : 'watched' };
    }
    return null;
  }).filter(Boolean);
}

// Netflix titles look like "Show: Season 2: Episode Name" or
// "Show: Limited Series: Episode" for TV, or just the title for films.
const NETFLIX_TV = /^(.*?):\s*(Season|Series|Part|Volume|Chapter|Limited Series|Miniseries|Collection|Book)\b/i;

function parseNetflix(rows) {
  const byTitle = new Map();
  rows.forEach((row) => {
    const raw = row.Title || '';
    if (!raw || /\(Trailer|Teaser|Hook\b|_hook_/i.test(raw) || row['Supplemental Video Type']) return;
    const tv = raw.match(NETFLIX_TV);
    const title = tv ? tv[1].trim() : raw;
    const kind = tv ? 'tv' : 'unknown';
    const key = `${kind}|${title.toLowerCase()}`;
    const watchedAt = isoDate(row.Date || row['Start Time']);
    const existing = byTitle.get(key);
    if (!existing || (watchedAt && watchedAt > (existing.watchedAt || ''))) {
      byTitle.set(key, { source: 'netflix', kind, title, watchedAt, list: kind === 'tv' ? 'watching' : 'watched' });
    }
  });
  return [...byTitle.values()];
}

// Recognise each file by its contents (not just its name) and parse it.
export function parseImport(files) {
  const records = [];
  const sources = new Set();
  const letterboxd = [];
  files.forEach(({ name, text }) => {
    if (name.toLowerCase().endsWith('.json')) {
      let data = null;
      try { data = JSON.parse(text); } catch { return; }
      if (Array.isArray(data) && data.some((item) => item?.movie || item?.show)) {
        records.push(...parseTrakt(name, data));
        sources.add('Trakt');
      }
      return;
    }
    const rows = parseCsv(text);
    if (!rows.length) return;
    const columns = Object.keys(rows[0]);
    if (columns.includes('Letterboxd URI')) {
      letterboxd.push({ name, rows });
      sources.add('Letterboxd');
    } else if (columns.includes('Const') && columns.includes('Title Type')) {
      records.push(...parseImdb(rows));
      sources.add('IMDb');
    } else if (columns.includes('Title') && (columns.includes('Date') || columns.includes('Start Time'))) {
      records.push(...parseNetflix(rows));
      sources.add('Netflix');
    }
  });
  if (letterboxd.length) records.push(...parseLetterboxd(letterboxd));
  return { records, sources: [...sources] };
}

// ── Matching ───────────────────────────────────────────────────────────

function normalizeTitle(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function findOnTmdb(record) {
  if (record.tmdbId) {
    const kind = record.kind === 'tv' ? 'tv' : 'movie';
    const data = await tmdbGet(`/${kind}/${record.tmdbId}`);
    return data ? normalizeTmdbResult({ ...data, media_type: kind }, kind === 'tv' ? 'tv_show' : 'movie') : null;
  }
  if (record.imdbId) {
    const found = await tmdbGet(`/find/${record.imdbId}`, { external_source: 'imdb_id' });
    const movie = found?.movie_results?.[0];
    const show = found?.tv_results?.[0];
    if (movie && record.kind !== 'tv') return normalizeTmdbResult(movie, 'movie');
    if (show) return normalizeTmdbResult(show, 'tv_show');
    if (movie) return normalizeTmdbResult(movie, 'movie');
  }
  if (!record.title) return null;
  const kinds = record.kind === 'tv' ? ['tv'] : record.kind === 'movie' ? ['movie'] : ['tv', 'movie'];
  for (const kind of kinds) {
    const params = { query: record.title, include_adult: 'false' };
    if (record.year) params[kind === 'tv' ? 'first_air_date_year' : 'year'] = String(record.year);
    // eslint-disable-next-line no-await-in-loop
    const data = await tmdbGet(`/search/${kind}`, params);
    const results = data?.results || [];
    const wanted = normalizeTitle(record.title);
    const exact = results.find((result) => normalizeTitle(result.title || result.name) === wanted);
    const pick = exact || (record.year ? results[0] : null);
    if (pick) return normalizeTmdbResult({ ...pick, media_type: kind }, kind === 'tv' ? 'tv_show' : 'movie');
  }
  return null;
}

// → { matched: [{ record, item }], unmatched: [record] }
export async function matchRecords(records, onProgress = () => {}) {
  const found = new Array(records.length).fill(null);
  let done = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < records.length) {
      const index = cursor;
      cursor += 1;
      // eslint-disable-next-line no-await-in-loop
      found[index] = await findOnTmdb(records[index]).catch(() => null);
      done += 1;
      onProgress({ phase: 'match', done, total: records.length });
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  const matched = [];
  const unmatched = [];
  for (const mediaType of ['movie', 'tv_show']) {
    const indexes = found.map((result, index) => (result?.mediaType === mediaType ? index : -1)).filter((index) => index >= 0);
    for (let i = 0; i < indexes.length; i += 150) {
      const slice = indexes.slice(i, i + 150);
      // eslint-disable-next-line no-await-in-loop
      const items = await resolveTmdbItems(slice.map((index) => found[index]), mediaType).catch(() => []);
      const byTmdb = new Map(items.map((item) => [item._tmdb?.tmdbId, item]));
      slice.forEach((index) => {
        const item = byTmdb.get(found[index].tmdbId);
        if (item) matched.push({ record: records[index], item });
        else unmatched.push(records[index]);
      });
    }
  }
  found.forEach((result, index) => { if (!result) unmatched.push(records[index]); });
  return { matched, unmatched };
}

// ── Saving ─────────────────────────────────────────────────────────────

const RATING_TABLE = { movie: 'movie_ratings', tv_show: 'tv_show_ratings' };

// options: { overwriteRatings }. → { rated, listed, skipped }
export async function applyImport(matched, { overwriteRatings = false } = {}, onProgress = () => {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in to import your history.');
  const profileId = getActiveProfileId();

  // One entry per title: a rating beats "watched" beats "watching" beats the watchlist.
  const rank = { rated: 3, watched: 2, watching: 1, watchlist: 0 };
  const byTitle = new Map();
  matched.forEach(({ record, item }) => {
    const key = `${item.media_type}:${item.id}`;
    const existing = byTitle.get(key);
    if (!existing || rank[record.list] > rank[existing.record.list]) byTitle.set(key, { record, item });
  });
  const entries = [...byTitle.values()];

  const existingRatings = {};
  for (const mediaType of ['movie', 'tv_show']) {
    let query = supabase.from(RATING_TABLE[mediaType]).select('media_id').eq('user_id', user.id);
    query = profileId ? query.eq('profile_id', profileId) : query;
    // eslint-disable-next-line no-await-in-loop
    const { data } = await query;
    existingRatings[mediaType] = new Set((data || []).map((row) => Number(row.media_id)));
  }

  let rated = 0;
  let listed = 0;
  let skipped = 0;
  const ratingRows = { movie: [], tv_show: [] };
  const listRows = [];
  entries.forEach(({ record, item }) => {
    const mediaType = item.media_type;
    if (record.list === 'rated' && record.rating) {
      if (!overwriteRatings && existingRatings[mediaType].has(Number(item.id))) { skipped += 1; return; }
      ratingRows[mediaType].push({
        user_id: user.id,
        profile_id: profileId,
        media_id: Number(item.id),
        ...buildUniformCategories(mediaType, record.rating),
        ...(record.ratedAt || record.watchedAt ? { created_at: record.ratedAt || record.watchedAt } : {}),
      });
      return;
    }
    const status = record.list === 'watchlist' ? 'plan_to_watch' : record.list === 'watching' && mediaType === 'tv_show' ? 'watching' : 'watched';
    listRows.push({
      user_id: user.id,
      profile_id: profileId,
      media_type: mediaType,
      media_id: Number(item.id),
      status,
      ...(record.watchedAt ? { added_at: record.watchedAt } : {}),
    });
  });

  const total = ratingRows.movie.length + ratingRows.tv_show.length + listRows.length;
  let written = 0;
  for (const mediaType of ['movie', 'tv_show']) {
    for (let i = 0; i < ratingRows[mediaType].length; i += 200) {
      const batch = ratingRows[mediaType].slice(i, i + 200);
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.from(RATING_TABLE[mediaType]).upsert(batch, { onConflict: 'user_id,media_id,profile_id' });
      if (error) throw new Error(`Couldn’t save ratings: ${error.message}`);
      rated += batch.length;
      written += batch.length;
      onProgress({ phase: 'save', done: written, total });
    }
  }
  for (let i = 0; i < listRows.length; i += 200) {
    const batch = listRows.slice(i, i + 200);
    // Never downgrade something already on My List (ignoreDuplicates).
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabase.from('watchlist').upsert(batch, { onConflict: 'user_id,media_type,media_id,profile_id', ignoreDuplicates: true });
    if (error) throw new Error(`Couldn’t save your list: ${error.message}`);
    listed += batch.length;
    written += batch.length;
    onProgress({ phase: 'save', done: written, total });
  }
  return { rated, listed, skipped };
}
