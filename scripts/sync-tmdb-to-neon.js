#!/usr/bin/env node
/**
 * sync-tmdb-to-neon.js
 *
 * Downloads TMDB bulk export files (every movie and TV show on the platform),
 * finds IDs not yet in Neon Postgres, fetches full details from TMDB API,
 * and upserts them directly into the movies / tv_shows tables in Neon.
 *
 * Designed to run in GitHub Actions on schedule or manually via workflow_dispatch.
 *
 * Required env vars:
 *   DATABASE_URL — Neon Postgres connection string
 *   TMDB_API_KEY — v3 API key from themoviedb.org
 *
 * Optional env vars:
 *   TMDB_READ_TOKEN     — v4 Read Access Token (Bearer auth for exports)
 *   TYPE                — "movie" | "tv" | "both" (default: "both")
 *   MAX_DETAILS_PER_RUN — items to enrich per run (default: 5000)
 *   MIN_POPULARITY      — skip items below this score (default: 1)
 */

'use strict';

try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch {}

const zlib = require('zlib');
const rl = require('readline');
const { Readable } = require('stream');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_READ_TOKEN = process.env.TMDB_READ_TOKEN;
const TYPE = process.env.TYPE || 'both';
const MAX_PER_RUN = parseInt(process.env.MAX_DETAILS_PER_RUN || '5000', 10);
const MIN_POP = parseFloat(process.env.MIN_POPULARITY || '1');
const API_DELAY = 260; // ms between TMDB requests (under 40 req/10s)
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BASE = 'https://api.themoviedb.org/3';

let pool;

function getPool() {
  if (!pool) {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured.');
    }
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadExport(type) {
  function dateStr(d) {
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${mm}_${dd}_${yyyy}`;
  }

  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const candidates = [dateStr(today), dateStr(yesterday)];

  for (const ds of candidates) {
    const url = `http://files.tmdb.org/p/exports/${type}_${ds}.json.gz`;
    console.log(`  Downloading export: ${url}`);
    try {
      const headers = TMDB_READ_TOKEN ? { Authorization: `Bearer ${TMDB_READ_TOKEN}` } : {};
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(60000) });
      if (!res.ok) continue;

      const buf = Buffer.from(await res.arrayBuffer());
      const decompressed = zlib.gunzipSync(buf);
      const items = [];

      const lines = rl.createInterface({
        input: Readable.from(decompressed),
        crlfDelay: Infinity,
      });

      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (item.adult === true) continue;
          if (MIN_POP > 0 && typeof item.popularity === 'number' && item.popularity < MIN_POP) continue;
          items.push(item);
        } catch {}
      }

      items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      console.log(`  Parsed ${items.length.toLocaleString()} valid items from export`);
      return items;
    } catch (err) {
      console.warn(`  Failed ${ds}: ${err.message}`);
    }
  }

  throw new Error(`Could not download ${type} export from TMDB`);
}

async function getExistingKeys(table) {
  const p = getPool();
  process.stdout.write(`  Fetching existing keys from Neon ${table}… `);
  const res = await p.query(`SELECT source_key FROM ${table} WHERE source_key LIKE 'tmdb:%'`);
  const keys = new Set(res.rows.map((r) => r.source_key).filter(Boolean));
  console.log(`${keys.size.toLocaleString()} found`);
  return keys;
}

async function tmdbFetch(path, params = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 429) {
    const wait = parseInt(res.headers.get('retry-after') || '10', 10);
    console.log(`\n  ⏳ Rate limited — waiting ${wait}s`);
    await sleep(wait * 1000);
    return tmdbFetch(path, params);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return res.json();
}

function movieRecord(d) {
  if (!d?.title || d.adult === true) return null;

  const crew = d.credits?.crew || [];
  const cast = d.credits?.cast || [];
  const usRel = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'US');
  const rating = usRel?.release_dates?.find((r) => r.certification)?.certification || null;

  const director = crew.find((c) => c.job === 'Director')?.name || null;
  const writers = crew
    .filter((c) => ['Screenplay', 'Writer', 'Story'].includes(c.job))
    .map((c) => c.name)
    .slice(0, 3)
    .join(', ') || null;
  const castMembers = cast.slice(0, 5).map((c) => c.name).join(', ') || null;

  const year = d.release_date ? parseInt(d.release_date.slice(0, 4), 10) : null;
  const posterUrl = d.poster_path ? `${POSTER_BASE}${d.poster_path}` : null;
  const genre = (d.genres || []).map((g) => g.name).join(', ') || null;

  return {
    title: d.title.slice(0, 500),
    year: Number.isFinite(year) ? year : null,
    genre,
    director,
    writers,
    cast_members: castMembers,
    age_rating: rating || null,
    overview: d.overview || null,
    synopsis: d.overview || null,
    poster_url: posterUrl,
    source_key: `tmdb:movie:${d.id}`,
    release_date: d.release_date || null,
    imdb_id: d.imdb_id || d.external_ids?.imdb_id || null,
    vote_average: d.vote_average ?? null,
    popularity: d.popularity ?? null,
    original_language: d.original_language || null,
  };
}

function tvRecord(d) {
  if (!d?.name) return null;

  const crew = d.credits?.crew || [];
  const cast = d.credits?.cast || [];
  const usRel = (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'US');
  const rating = usRel?.rating || null;

  const creator = (d.created_by || []).map((c) => c.name).join(', ') ||
    crew.find((c) => ['Creator', 'Executive Producer'].includes(c.job))?.name || null;
  const writers = crew
    .filter((c) => ['Writer', 'Story', 'Teleplay'].includes(c.job))
    .map((c) => c.name)
    .slice(0, 3)
    .join(', ') || null;
  const castMembers = cast.slice(0, 5).map((c) => c.name).join(', ') || null;

  const year = d.first_air_date ? parseInt(d.first_air_date.slice(0, 4), 10) : null;
  const posterUrl = d.poster_path ? `${POSTER_BASE}${d.poster_path}` : null;
  const genre = (d.genres || []).map((g) => g.name).join(', ') || null;

  return {
    title: d.name.slice(0, 500),
    year: Number.isFinite(year) ? year : null,
    genre,
    creator,
    writers,
    cast_members: castMembers,
    age_rating: rating || null,
    overview: d.overview || null,
    synopsis: d.overview || null,
    poster_url: posterUrl,
    seasons: d.number_of_seasons || null,
    source_key: `tmdb:tv:${d.id}`,
    original_language: d.original_language || null,
    release_date: d.first_air_date || null,
    imdb_id: d.external_ids?.imdb_id || null,
    vote_average: d.vote_average ?? null,
    popularity: d.popularity ?? null,
  };
}

async function upsertBatch(table, items) {
  if (!items.length) return;
  const p = getPool();

  const cols = Object.keys(items[0]);
  const colNames = cols.join(', ');

  const updateCols = cols
    .filter((c) => c !== 'source_key')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');

  for (const item of items) {
    const values = cols.map((c) => item[c]);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const query = `
      INSERT INTO ${table} (${colNames})
      VALUES (${placeholders})
      ON CONFLICT (source_key) DO UPDATE SET ${updateCols}
    `;
    await p.query(query, values);
  }
}

async function syncMediaType(mediaType) {
  const isMovie = mediaType === 'movie';
  const table = isMovie ? 'movies' : 'tv_shows';
  const exportType = isMovie ? 'movie_ids' : 'tv_series_ids';
  const apiPath = isMovie ? '/movie' : '/tv';
  const appendTo = isMovie ? 'credits,release_dates,external_ids' : 'credits,content_ratings,external_ids';
  const format = isMovie ? movieRecord : tvRecord;
  const prefix = isMovie ? 'tmdb:movie:' : 'tmdb:tv:';

  console.log(`\n====================================================`);
  console.log(`  Syncing ${isMovie ? '🎬 Movies' : '📺 TV Shows'} to Neon Postgres`);
  console.log(`====================================================`);

  const exportItems = await downloadExport(exportType);
  const existingKeys = await getExistingKeys(table);

  const newItems = exportItems.filter((item) => !existingKeys.has(`${prefix}${item.id}`));
  const toFetch = newItems.slice(0, MAX_PER_RUN);

  console.log(`  ${newItems.length.toLocaleString()} new items available  |  fetching ${toFetch.length.toLocaleString()} this run`);

  let fetched = 0;
  let upserted = 0;
  let skipped = 0;
  const batch = [];

  for (const item of toFetch) {
    try {
      const details = await tmdbFetch(`${apiPath}/${item.id}`, { append_to_response: appendTo });
      await sleep(API_DELAY);

      const record = details ? format(details) : null;
      if (!record) {
        skipped++;
        continue;
      }

      batch.push(record);
      fetched++;

      if (batch.length >= 100) {
        await upsertBatch(table, batch);
        upserted += batch.length;
        batch.length = 0;
      }

      process.stdout.write(`\r  ${fetched} fetched  |  ${upserted} upserted  |  ${skipped} skipped`);
    } catch (err) {
      if (err.name !== 'AbortError') skipped++;
    }
  }

  if (batch.length > 0) {
    await upsertBatch(table, batch);
    upserted += batch.length;
  }

  console.log(`\n  Finished ${table}: ${upserted} upserted.`);
}

async function main() {
  if (!TMDB_KEY) {
    console.error('Missing TMDB_API_KEY environment variable.');
    process.exit(1);
  }
  if (!DATABASE_URL) {
    console.error('Missing DATABASE_URL environment variable.');
    process.exit(1);
  }

  const start = Date.now();
  console.log('Starting TMDB -> Neon Postgres sync...');

  if (TYPE === 'movie' || TYPE === 'both') {
    await syncMediaType('movie');
  }
  if (TYPE === 'tv' || TYPE === 'both') {
    await syncMediaType('tv');
  }

  if (pool) {
    await pool.end();
  }

  console.log(`\nSync complete in ${Math.round((Date.now() - start) / 1000)}s.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal sync error:', err);
    if (pool) pool.end();
    process.exit(1);
  });
}

module.exports = { movieRecord, tvRecord };

