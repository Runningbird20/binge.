#!/usr/bin/env node
/**
 * sync-catalog.js
 *
 * Universal catalog sync script for binge.
 * Supports syncing:
 *   - Movies (TMDB bulk exports & API)
 *   - TV Shows (TMDB bulk exports & API)
 *   - Books (Open Library subjects & trending)
 *   - Manga (MangaDex top & updated titles)
 *
 * Targets:
 *   - Standalone PostgreSQL server via DATABASE_URL (primary)
 *   - Supabase via SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY (fallback)
 *
 * Usage:
 *   node scripts/sync-catalog.js --type movie
 *   node scripts/sync-catalog.js --type tv
 *   node scripts/sync-catalog.js --type books
 *   node scripts/sync-catalog.js --type manga
 *   node scripts/sync-catalog.js --type all
 */

'use strict';

const path = require('path');
const zlib = require('zlib');
const rl = require('readline');
const { Readable } = require('stream');
const crypto = require('crypto');

try { require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') }); } catch {}
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

// ── Database client setup ─────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set. Set DATABASE_URL to your PostgreSQL database connection string.');
  process.exit(1);
}

const { Client } = require('pg');
const pgClient = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });

// ── CLI & Env Config ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const TYPE = getArg('--type', process.env.TYPE || 'both');
const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_READ_TOKEN = process.env.TMDB_READ_TOKEN;
const MAX_PER_RUN = parseInt(getArg('--max', process.env.MAX_DETAILS_PER_RUN || '5000'), 10);
const MIN_POP = parseFloat(getArg('--min-pop', process.env.MIN_POPULARITY || '1'));
const API_DELAY = 260; // ms
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const MDX_BASE = 'https://api.mangadex.org';
const MDX_COVERS = 'https://uploads.mangadex.org/covers';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Database Operations ───────────────────────────────────────────────────────

async function initDb() {
  await pgClient.connect();
  await pgClient.query('CREATE SCHEMA IF NOT EXISTS binge;');
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS binge.records (
      collection text NOT NULL,
      id text NOT NULL,
      data jsonb NOT NULL,
      PRIMARY KEY (collection, id)
    );
  `);
}

async function closeDb() {
  if (pgClient) {
    await pgClient.end().catch(() => {});
  }
}

async function getExistingSourceKeys(collection, prefix) {
  const keys = new Set();
  const { rows } = await pgClient.query(
    "SELECT data->>'source_key' AS source_key FROM binge.records WHERE collection = $1 AND data->>'source_key' LIKE $2",
    [collection, `${prefix}%`]
  );
  rows.forEach((r) => { if (r.source_key) keys.add(r.source_key); });
  return keys;
}

async function upsertRecords(collection, records) {
  if (!records.length) return;

  for (const record of records) {
    const id = String(record.id || record.source_key || crypto.randomUUID());
    record.id = id;
    await pgClient.query(
      `INSERT INTO binge.records (collection, id, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (collection, id)
       DO UPDATE SET data = excluded.data`,
      [collection, id, JSON.stringify(record)]
    );
  }
}

// ── TMDB Sync (Movies & Series) ───────────────────────────────────────────────

async function downloadTmdbExport(type) {
  const tryDate = async (offsetDays) => {
    const d = new Date(Date.now() - offsetDays * 86_400_000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const file = `${type}_${mm}_${dd}_${yyyy}.json.gz`;
    const url = `https://files.tmdb.org/p/exports/${file}`;
    console.log(`  Downloading ${url}`);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(180_000),
      headers: TMDB_READ_TOKEN ? { Authorization: `Bearer ${TMDB_READ_TOKEN}` } : {},
    });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Export HTTP ${res.status}`);
    return res;
  };

  let res = await tryDate(0) || await tryDate(1) || await tryDate(2);
  if (!res) throw new Error(`Could not download TMDB export for ${type}`);

  const items = [];
  const gunzip = zlib.createGunzip();
  const nodeStream = Readable.fromWeb(res.body).pipe(gunzip);
  const lines = rl.createInterface({ input: nodeStream, crlfDelay: Infinity });

  await new Promise((resolve, reject) => {
    lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        if (obj.adult === true) return;
        if (MIN_POP > 0 && (obj.popularity || 0) < MIN_POP) return;
        items.push(obj);
      } catch {}
    });
    lines.on('close', resolve);
    lines.on('error', reject);
    gunzip.on('error', reject);
  });

  items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  return items;
}

async function tmdbFetch(apiPath, params = {}) {
  const url = new URL(`${TMDB_BASE}${apiPath}`);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 429) {
    const wait = parseInt(res.headers.get('retry-after') || '10', 10);
    console.log(`  Rate limited by TMDB. Waiting ${wait}s...`);
    await sleep(wait * 1000);
    return tmdbFetch(apiPath, params);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status} on ${apiPath}`);
  return res.json();
}

function formatMovie(d) {
  if (!d?.title || d.adult === true) return null;
  const crew = d.credits?.crew || [];
  const cast = d.credits?.cast || [];
  const usRel = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'US');
  const rating = usRel?.release_dates?.find((r) => r.certification)?.certification || null;
  const year = d.release_date ? parseInt(d.release_date, 10) || null : null;

  return {
    id: `tmdb:movie:${d.id}`,
    title: d.title,
    year,
    genre: (d.genres || []).map((g) => g.name).join(', ') || null,
    director: crew.filter((p) => p.job === 'Director').slice(0, 3).map((p) => p.name).join(', ') || null,
    writers: crew.filter((p) => ['Writer', 'Screenplay', 'Story'].includes(p.job)).slice(0, 3).map((p) => p.name).join(', ') || null,
    cast_members: cast.slice(0, 8).map((p) => p.name).join(', ') || null,
    age_rating: rating,
    overview: d.overview || null,
    synopsis: d.overview || null,
    poster_url: d.poster_path ? `${POSTER_BASE}${d.poster_path}` : null,
    source_key: `tmdb:movie:${d.id}`,
    release_date: d.release_date || null,
    imdb_id: d.imdb_id || null,
    vote_average: d.vote_average ?? null,
    popularity: d.popularity ?? null,
    original_language: d.original_language || null,
  };
}

function formatTv(d) {
  if (!d?.name || d.adult === true) return null;
  const cast = d.credits?.cast || [];
  const rating = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'US')?.rating || null;
  const year = d.first_air_date ? parseInt(d.first_air_date, 10) || null : null;

  return {
    id: `tmdb:tv:${d.id}`,
    title: d.name,
    year,
    genre: (d.genres || []).map((g) => g.name).join(', ') || null,
    creator: (d.created_by || []).slice(0, 3).map((p) => p.name).join(', ') || null,
    cast_members: cast.slice(0, 8).map((p) => p.name).join(', ') || null,
    age_rating: rating,
    overview: d.overview || null,
    synopsis: d.overview || null,
    poster_url: d.poster_path ? `${POSTER_BASE}${d.poster_path}` : null,
    seasons: d.number_of_seasons || null,
    source_key: `tmdb:tv:${d.id}`,
    vote_average: d.vote_average ?? null,
    popularity: d.popularity ?? null,
    original_language: d.original_language || null,
  };
}

async function syncTmdb(mediaType) {
  if (!TMDB_KEY) {
    console.log(`⚠️  TMDB_API_KEY is not set; skipping ${mediaType} sync.`);
    return;
  }

  const isMovie = mediaType === 'movie';
  const collection = isMovie ? 'movies' : 'tv_shows';
  const exportType = isMovie ? 'movie_ids' : 'tv_series_ids';
  const apiPath = isMovie ? '/movie' : '/tv';
  const appendTo = isMovie ? 'credits,release_dates,external_ids' : 'credits,content_ratings';
  const format = isMovie ? formatMovie : formatTv;
  const prefix = isMovie ? 'tmdb:movie:' : 'tmdb:tv:';

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Syncing ${isMovie ? '🎬 Movies' : '📺 TV Series'} (TMDB)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const exportItems = await downloadTmdbExport(exportType);
  const existingKeys = await getExistingSourceKeys(collection, prefix);
  const newItems = exportItems.filter((item) => !existingKeys.has(`${prefix}${item.id}`));
  const toFetch = newItems.slice(0, MAX_PER_RUN);

  console.log(`  Found ${newItems.length.toLocaleString()} new items; fetching ${toFetch.length.toLocaleString()} this run`);

  let fetched = 0, upserted = 0;
  const batch = [];

  for (const item of toFetch) {
    try {
      const details = await tmdbFetch(`${apiPath}/${item.id}`, { append_to_response: appendTo });
      await sleep(API_DELAY);
      const record = details ? format(details) : null;
      if (!record) continue;

      batch.push(record);
      fetched++;

      if (batch.length >= 100) {
        await upsertRecords(collection, batch.splice(0));
        upserted = fetched;
        process.stdout.write(`\r  ${fetched} fetched / ${upserted} upserted`);
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error(`\n  Error fetching ${item.id}:`, err.message);
    }
  }

  if (batch.length) {
    await upsertRecords(collection, batch.splice(0));
    upserted = fetched;
  }

  console.log(`\n  ✓ ${fetched} ${collection} successfully synced.`);
}

// ── Books Sync (Open Library) ─────────────────────────────────────────────────

const BOOK_SUBJECTS = [
  'fiction', 'science_fiction', 'fantasy', 'mystery', 'thriller',
  'horror', 'romance', 'historical_fiction', 'young_adult', 'biography', 'history'
];

async function syncBooks() {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Syncing 📚 Books (Open Library)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const existingKeys = await getExistingSourceKeys('books', 'openlibrary:');
  let totalNew = 0;

  for (const subject of BOOK_SUBJECTS) {
    try {
      const url = `https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=50`;
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const data = await res.json();
      const works = data.works || [];

      const records = [];
      for (const work of works) {
        const key = work.key ? String(work.key).replace('/works/', '') : null;
        if (!key) continue;
        const sourceKey = `openlibrary:${key}`;
        if (existingKeys.has(sourceKey)) continue;

        const title = work.title;
        if (!title) continue;

        const author = (work.authors || []).map((a) => a.name).filter(Boolean).join(', ') || null;
        const coverId = work.cover_id;
        const coverUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null;
        const genre = subject.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

        records.push({
          id: `ol:${key}`,
          title,
          author,
          year: work.first_publish_year || null,
          genre,
          synopsis: typeof work.description === 'string' ? work.description : work.description?.value || null,
          cover_url: coverUrl,
          source_key: sourceKey,
        });

        existingKeys.add(sourceKey);
      }

      if (records.length) {
        await upsertRecords('books', records);
        totalNew += records.length;
        console.log(`  ${subject}: ${records.length} new books added`);
      }
      await sleep(500);
    } catch (err) {
      console.warn(`  Failed syncing subject ${subject}:`, err.message);
    }
  }

  console.log(`  ✓ ${totalNew} books synced.`);
}

// ── Manga Sync (MangaDex) ─────────────────────────────────────────────────────

async function syncManga() {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Syncing 📖 Manga (MangaDex)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const existingKeys = await getExistingSourceKeys('books', 'mangadex:');
  let totalNew = 0;

  try {
    const url = `${MDX_BASE}/manga?limit=80&order[followedCount]=desc&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`MangaDex HTTP ${res.status}`);
    const data = await res.json();
    const items = data.data || [];

    const records = [];
    for (const m of items) {
      const sourceKey = `mangadex:${m.id}`;
      if (existingKeys.has(sourceKey)) continue;

      const attrs = m.attributes || {};
      const title = attrs.title?.en || Object.values(attrs.title || {})[0];
      if (!title) continue;

      const desc = attrs.description?.en || Object.values(attrs.description || {})[0] || '';
      const cover = (m.relationships || []).find((r) => r.type === 'cover_art');
      const author = (m.relationships || []).find((r) => r.type === 'author');
      const tags = (attrs.tags || [])
        .filter((t) => t.attributes?.group === 'genre')
        .map((t) => t.attributes.name.en);

      const coverUrl = cover?.attributes?.fileName
        ? `${MDX_COVERS}/${m.id}/${cover.attributes.fileName}.512.jpg`
        : null;

      const genre = ['Manga', 'Graphic Novel', ...tags].filter(Boolean).slice(0, 4).join(', ');

      records.push({
        id: `mdx:${m.id}`,
        title,
        author: author?.attributes?.name || 'Unknown',
        year: attrs.year || null,
        genre,
        synopsis: desc.replace(/\[\w+\]/g, '').trim().slice(0, 600) || null,
        cover_url: coverUrl,
        source_key: sourceKey,
      });

      existingKeys.add(sourceKey);
    }

    if (records.length) {
      await upsertRecords('books', records);
      totalNew += records.length;
      console.log(`  Added ${records.length} popular manga titles to catalog`);
    }
  } catch (err) {
    console.warn('  MangaDex sync error:', err.message);
  }

  console.log(`  ✓ ${totalNew} manga titles synced.`);
}

// ── VidSrc Video Server Sync (Movies & TV Series) ──────────────────────────

async function fetchVidSrcJson(endpoint) {
  const hosts = ['https://vidsrc.io', 'https://vsembed.ru'];
  for (const host of hosts) {
    try {
      const url = `${host}${endpoint}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.result)) {
          return json.result;
        }
      }
    } catch {}
  }
  return [];
}

async function syncVidSrc(pages = 3) {
  console.log('\n[VidSrc Video Servers] Fetching latest movies and TV series...');

  let movieCount = 0;
  let showCount = 0;

  // 1. Movies from VidSrc
  for (let page = 1; page <= pages; page++) {
    try {
      const items = await fetchVidSrcJson(`/movies/latest/page-${page}.json`);
      if (!items || !items.length) break;

      const records = [];
      for (const item of items) {
        if (!item.title && !item.tmdb_id && !item.imdb_id) continue;
        const id = String(item.tmdb_id || item.imdb_id);
        const titleMatch = (item.title || '').match(/^(.*?)(?:\s+(19\d{2}|20\d{2}))?$/);
        const cleanTitle = (titleMatch ? titleMatch[1] : item.title || '').trim();
        const year = titleMatch && titleMatch[2] ? parseInt(titleMatch[2], 10) : null;

        records.push({
          id,
          title: cleanTitle || item.title,
          year,
          imdb_id: item.imdb_id || null,
          tmdb_id: item.tmdb_id ? String(item.tmdb_id) : null,
          source_key: item.tmdb_id ? `tmdb:movie:${item.tmdb_id}` : `vidsrc:movie:${item.imdb_id}`,
          embed_url: item.embed_url || (item.imdb_id ? `https://vidsrc.io/embed/movie?imdb=${item.imdb_id}` : null),
          embed_url_tmdb: item.embed_url_tmdb || (item.tmdb_id ? `https://vidsrc.io/embed/movie?tmdb=${item.tmdb_id}` : null),
          quality: item.quality || '1080p',
          poster_url: item.tmdb_id ? `https://image.tmdb.org/t/p/w500/${item.tmdb_id}.jpg` : null,
        });
      }

      if (records.length) {
        await upsertRecords('movies', records);
        movieCount += records.length;
      }
      await sleep(200);
    } catch (err) {
      console.warn(`  Failed fetching VidSrc movies page ${page}:`, err.message);
    }
  }

  // 2. TV Episodes from VidSrc
  const tvSeriesMap = new Map();
  for (let page = 1; page <= pages; page++) {
    try {
      const items = await fetchVidSrcJson(`/episodes/latest/page-${page}.json`);
      if (!items || !items.length) break;

      for (const ep of items) {
        const id = String(ep.tmdb_id || ep.imdb_id || ep.show_title);
        if (!id) continue;

        const titleMatch = (ep.show_title || '').match(/^(.*?)(?:\s+(19\d{2}|20\d{2}))?$/);
        const cleanTitle = (titleMatch ? titleMatch[1] : ep.show_title || '').trim();
        const year = titleMatch && titleMatch[2] ? parseInt(titleMatch[2], 10) : null;
        const seasonNum = parseInt(ep.season, 10) || 1;

        if (!tvSeriesMap.has(id)) {
          tvSeriesMap.set(id, {
            id,
            title: cleanTitle || ep.show_title,
            year,
            imdb_id: ep.imdb_id || null,
            tmdb_id: ep.tmdb_id ? String(ep.tmdb_id) : null,
            source_key: ep.tmdb_id ? `tmdb:tv:${ep.tmdb_id}` : `vidsrc:tv:${ep.imdb_id}`,
            seasons: seasonNum,
            embed_url: ep.embed_url || `https://vidsrc.io/embed/tv?imdb=${ep.imdb_id}&season=${ep.season}&episode=${ep.episode}`,
            embed_url_tmdb: ep.embed_url_tmdb || (ep.tmdb_id ? `https://vidsrc.io/embed/tv?tmdb=${ep.tmdb_id}&season=${ep.season}&episode=${ep.episode}` : null),
            quality: ep.quality || '1080p',
          });
        } else {
          const existing = tvSeriesMap.get(id);
          if (seasonNum > (existing.seasons || 1)) {
            existing.seasons = seasonNum;
          }
        }
      }
      await sleep(200);
    } catch (err) {
      console.warn(`  Failed fetching VidSrc episodes page ${page}:`, err.message);
    }
  }

  if (tvSeriesMap.size > 0) {
    const tvRecords = Array.from(tvSeriesMap.values());
    await upsertRecords('tv_shows', tvRecords);
    showCount = tvRecords.length;
  }

  console.log(`  ✓ Synced ${movieCount} movies and ${showCount} TV series from VidSrc video servers.`);
}

// ── Main Runner ───────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  binge.  Catalog Sync (PostgreSQL)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  type:            ${TYPE}`);
  console.log(`  started:         ${new Date().toISOString()}`);

  try {
    await initDb();

    if (['vidsrc', 'video', 'both', 'all'].includes(TYPE)) await syncVidSrc(TYPE === 'vidsrc' ? 5 : 3);
    if (['movie', 'movies', 'both', 'all'].includes(TYPE)) await syncTmdb('movie');
    if (['tv', 'shows', 'both', 'all'].includes(TYPE)) await syncTmdb('tv');
    if (['books', 'all'].includes(TYPE)) await syncBooks();
    if (['manga', 'all'].includes(TYPE)) await syncManga();
  } catch (err) {
    console.error('\n❌ Fatal sync error:', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
    console.log(`\n  finished: ${new Date().toISOString()}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

main();

