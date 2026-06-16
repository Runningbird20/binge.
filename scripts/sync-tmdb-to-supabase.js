#!/usr/bin/env node
/**
 * sync-tmdb-to-supabase.js
 *
 * Downloads TMDB bulk export files (every movie and TV show on the platform —
 * Bollywood, K-drama, anime, international indie, everything), finds IDs not
 * yet in Supabase, fetches full details from the TMDB API, and upserts them
 * directly into the movies / tv_shows tables.
 *
 * Designed to run inside GitHub Actions every 6 hours — never on your machine.
 *
 * Required env vars:
 *   TMDB_API_KEY              — https://www.themoviedb.org/settings/api
 *   SUPABASE_URL              — your project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS for writes)
 *
 * Optional env vars:
 *   TYPE                — "movie" | "tv" | "both"  (default: "both")
 *   MAX_DETAILS_PER_RUN — how many new items to enrich per run (default: 5000)
 *   MIN_POPULARITY      — skip items below this TMDB popularity score (default: 1)
 *                         Set to 0 for truly everything (needs Supabase Pro for storage)
 */

'use strict';

// Load .env only when running locally (GitHub Actions supplies env vars directly)
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch {}

const zlib    = require('zlib');
const rl      = require('readline');
const { Readable } = require('stream');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const TMDB_KEY    = process.env.TMDB_API_KEY;
const SUP_URL     = process.env.SUPABASE_URL;
const SUP_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TYPE        = process.env.TYPE || 'both';
const MAX_PER_RUN = parseInt(process.env.MAX_DETAILS_PER_RUN || '5000', 10);
const MIN_POP     = parseFloat(process.env.MIN_POPULARITY || '1');
const UPSERT_SIZE = 500;
const API_DELAY   = 260; // ms between TMDB requests — keeps us under 4 req/s (limit: 40/10s)
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BASE   = 'https://api.themoviedb.org/3';

if (!TMDB_KEY || !SUP_URL || !SUP_KEY) {
  console.error('❌  Missing env vars: TMDB_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUP_URL, SUP_KEY, { auth: { persistSession: false } });

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Download and parse a TMDB bulk export file (gzipped NDJSON).
 * Falls back to yesterday's file if today's isn't available yet (TMDB
 * publishes them at ~8am UTC).
 */
async function downloadExport(type) {
  const tryDate = async (offsetDays) => {
    const d = new Date(Date.now() - offsetDays * 86_400_000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const file = `${type}_${mm}_${dd}_${yyyy}.json.gz`;
    const url  = `https://files.tmdb.org/p/exports/${file}`;
    console.log(`  Downloading ${url}`);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(180_000),
      headers: { Authorization: `Bearer ${TMDB_KEY}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Export HTTP ${res.status}`);
    return res;
  };

  let res = await tryDate(0);
  if (!res) {
    console.log('  Today\'s export not yet available — falling back to yesterday\'s');
    res = await tryDate(1);
  }
  if (!res) throw new Error(`Could not download export for type=${type}`);

  const items = [];
  const gunzip = zlib.createGunzip();
  // Convert Web ReadableStream → Node.js Readable (Node 18+)
  const nodeStream = Readable.fromWeb(res.body).pipe(gunzip);
  const lines = rl.createInterface({ input: nodeStream, crlfDelay: Infinity });

  await new Promise((resolve, reject) => {
    lines.on('line', line => {
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

  // Enrich popular content first — makes the catalog useful sooner
  items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  console.log(`  → ${items.length.toLocaleString()} items after popularity filter (MIN_POPULARITY=${MIN_POP})`);
  return items;
}

/**
 * Fetch all source_keys from a Supabase table, paginated.
 * Returns a Set<string> of keys like "tmdb:movie:12345".
 */
async function getExistingKeys(table) {
  const keys = new Set();
  const PAGE  = 1000;
  let   from  = 0;

  process.stdout.write(`  Fetching existing keys from ${table}…`);
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('source_key')
      .not('source_key', 'is', null)
      .like('source_key', 'tmdb:%')
      .range(from, from + PAGE - 1);

    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) if (row.source_key) keys.add(row.source_key);
    if (data.length < PAGE) break;
    from += PAGE;
    process.stdout.write('.');
  }
  console.log(` ${keys.size.toLocaleString()} found`);
  return keys;
}

/** TMDB API fetch with automatic retry on 429 rate-limit responses. */
async function tmdbFetch(path, params = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
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

// ── Record formatters ─────────────────────────────────────────────────────────

function movieRecord(d) {
  if (!d?.title || d.adult === true) return null;

  const crew    = d.credits?.crew || [];
  const cast    = d.credits?.cast || [];
  const usRel   = (d.release_dates?.results || []).find(r => r.iso_3166_1 === 'US');
  const rating  = usRel?.release_dates?.find(r => r.certification)?.certification || null;
  const year    = d.release_date ? parseInt(d.release_date, 10) || null : null;

  return {
    title:             d.title,
    year,
    genre:             (d.genres || []).map(g => g.name).join(', ') || null,
    director:          crew.filter(p => p.job === 'Director').slice(0, 3).map(p => p.name).join(', ') || null,
    writers:           crew.filter(p => ['Writer','Screenplay','Story'].includes(p.job)).slice(0, 3).map(p => p.name).join(', ') || null,
    cast_members:      cast.slice(0, 8).map(p => p.name).join(', ') || null,
    age_rating:        rating,
    overview:          d.overview || null,
    synopsis:          d.overview || null,
    poster_url:        d.poster_path ? `${POSTER_BASE}${d.poster_path}` : null,
    source_key:        `tmdb:movie:${d.id}`,
    release_date:      d.release_date || null,
    imdb_id:           d.imdb_id || null,
    vote_average:      d.vote_average ?? null,
    popularity:        d.popularity ?? null,
    original_language: d.original_language || null,
  };
}

function tvRecord(d) {
  if (!d?.name || d.adult === true) return null;

  const cast   = d.credits?.cast || [];
  const rating = (d.content_ratings?.results || []).find(r => r.iso_3166_1 === 'US')?.rating || null;
  const year   = d.first_air_date ? parseInt(d.first_air_date, 10) || null : null;

  return {
    title:             d.name,
    year,
    genre:             (d.genres || []).map(g => g.name).join(', ') || null,
    creator:           (d.created_by || []).slice(0, 3).map(p => p.name).join(', ') || null,
    cast_members:      cast.slice(0, 8).map(p => p.name).join(', ') || null,
    age_rating:        rating,
    overview:          d.overview || null,
    synopsis:          d.overview || null,
    poster_url:        d.poster_path ? `${POSTER_BASE}${d.poster_path}` : null,
    seasons:           d.number_of_seasons || null,
    source_key:        `tmdb:tv:${d.id}`,
    vote_average:      d.vote_average ?? null,
    popularity:        d.popularity ?? null,
    original_language: d.original_language || null,
  };
}

// ── Core sync ─────────────────────────────────────────────────────────────────

async function syncMediaType(mediaType) {
  const isMovie    = mediaType === 'movie';
  const table      = isMovie ? 'movies' : 'tv_shows';
  const exportType = isMovie ? 'movie_ids' : 'tv_series_ids';
  const apiPath    = isMovie ? '/movie' : '/tv';
  const appendTo   = isMovie ? 'credits,release_dates,external_ids' : 'credits,content_ratings';
  const format     = isMovie ? movieRecord : tvRecord;
  const prefix     = isMovie ? 'tmdb:movie:' : 'tmdb:tv:';

  console.log(`\n${'━'.repeat(52)}`);
  console.log(` ${isMovie ? '🎬 Movies' : '📺 TV Shows'}`);
  console.log(`${'━'.repeat(52)}`);

  const exportItems  = await downloadExport(exportType);
  const existingKeys = await getExistingKeys(table);

  const newItems = exportItems.filter(item => !existingKeys.has(`${prefix}${item.id}`));
  const toFetch  = newItems.slice(0, MAX_PER_RUN);

  console.log(`  ${newItems.length.toLocaleString()} new items  |  fetching ${toFetch.length.toLocaleString()} this run`);

  let fetched = 0, upserted = 0, skipped = 0;
  const pending = [];

  const flush = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: 'source_key', ignoreDuplicates: false });
    if (error) throw error;
    upserted += batch.length;
  };

  for (const item of toFetch) {
    try {
      const details = await tmdbFetch(`${apiPath}/${item.id}`, { append_to_response: appendTo });
      await sleep(API_DELAY);

      const record = details ? format(details) : null;
      if (!record) { skipped++; continue; }

      pending.push(record);
      fetched++;

      if (pending.length >= UPSERT_SIZE) await flush();
      process.stdout.write(`\r  ${fetched} fetched  ${upserted} upserted  ${skipped} skipped`);
    } catch (err) {
      if (err.name !== 'AbortError') skipped++;
    }
  }

  await flush();
  console.log(`\r  ✓ ${fetched} fetched  ${upserted} upserted  ${skipped} skipped`);

  if (newItems.length > MAX_PER_RUN) {
    console.log(`  ↩  ${(newItems.length - MAX_PER_RUN).toLocaleString()} items queued for next runs`);
  } else {
    console.log('  ✅ Catalog fully up to date for this type');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  binge.  TMDB → Supabase Catalog Sync');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  type:                ${TYPE}`);
  console.log(`  max details per run: ${MAX_PER_RUN.toLocaleString()}`);
  console.log(`  min popularity:      ${MIN_POP}  (0 = everything, 1 = filters spam)`);
  console.log(`  started:             ${new Date().toISOString()}`);

  try {
    if (TYPE === 'movie' || TYPE === 'both') await syncMediaType('movie');
    if (TYPE === 'tv'    || TYPE === 'both') await syncMediaType('tv');
  } catch (err) {
    console.error('\n❌ Fatal:', err.message);
    process.exit(1);
  }

  console.log(`\n  finished: ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main();
