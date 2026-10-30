#!/usr/bin/env node
/**
 * sync-language-to-neon.js
 *
 * Keeps one original language (Malayalam by default) complete and current in
 * the movies / tv_shows catalog. The bulk sync (sync-tmdb-to-neon.js)
 * works through TMDB's whole export by popularity and skips anything below
 * MIN_POPULARITY, so a small new regional release can wait weeks. This asks
 * TMDB discover directly:
 *
 *   1. Recent + upcoming: everything released in the last YEARS years or
 *      within the next 30 days (the site's Coming Soon window), newest first.
 *   2. All-time popular: the top POPULAR_PAGES pages by popularity.
 *
 * Titles not in the catalog are added. Titles released in the last
 * REFRESH_DAYS are re-fetched and updated even if present, because posters,
 * ratings and popularity fill in during a film's first weeks.
 *
 * Env vars (same as the bulk sync, minus TMDB_READ_TOKEN):
 *   TMDB_API_KEY, Neon DATABASE_URL
 *   LANGUAGES      comma-separated ISO 639-1 codes (default "ml")
 *   TYPE           "movie" | "tv" | "both" (default "both")
 *   YEARS          how far back the recent pass goes (default 3)
 *   POPULAR_PAGES  pages of all-time popular titles, 20 per page (default 25)
 *   REFRESH_DAYS   re-fetch titles released this recently (default 120)
 *
 * --dry-run only talks to TMDB and prints what it found. Nothing is written.
 */

'use strict';

try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch {}

const { createCatalogClient } = require('./neon-catalog-client');
const { movieRecord, tvRecord, tmdbFetch } = require('./tmdb-records');

const LANGUAGES     = (process.env.LANGUAGES || 'ml').split(',').map(s => s.trim()).filter(Boolean);
const TYPE          = process.env.TYPE || 'both';
const YEARS         = parseInt(process.env.YEARS || '3', 10);
const POPULAR_PAGES = parseInt(process.env.POPULAR_PAGES || '25', 10);
const REFRESH_DAYS  = parseInt(process.env.REFRESH_DAYS || '120', 10);
const DRY_RUN       = process.argv.includes('--dry-run');
const API_DELAY     = 260;
const UPSERT_SIZE   = 200;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isoDay = offsetDays => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** Every page of a discover query (TMDB stops at page 500). */
async function discoverAll(kind, params, maxPages = 500) {
  const results = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await tmdbFetch(`/discover/${kind}`, { ...params, page, include_adult: 'false' });
    await sleep(API_DELAY);
    if (!data?.results?.length) break;
    results.push(...data.results);
    if (page >= (data.total_pages || 1)) break;
  }
  return results;
}

async function candidates(kind, language) {
  const dateField = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
  const recent = await discoverAll(kind, {
    with_original_language: language,
    [`${dateField}.gte`]: isoDay(-365 * YEARS),
    [`${dateField}.lte`]: isoDay(30),
    sort_by: `${dateField}.desc`,
  });
  const popular = await discoverAll(kind, {
    with_original_language: language,
    sort_by: 'popularity.desc',
  }, POPULAR_PAGES);
  const byId = new Map();
  for (const item of [...recent, ...popular]) byId.set(item.id, item);
  return [...byId.values()];
}

/** source_keys already in the table, looked up for just these ids. */
async function existingKeys(supabase, table, keys) {
  const found = new Set();
  for (let i = 0; i < keys.length; i += 200) {
    const { data, error } = await supabase.from(table).select('source_key').in('source_key', keys.slice(i, i + 200));
    if (error) throw error;
    for (const row of data || []) found.add(row.source_key);
  }
  return found;
}

async function syncKind(supabase, kind, language) {
  const isMovie = kind === 'movie';
  const table   = isMovie ? 'movies' : 'tv_shows';
  const prefix  = isMovie ? 'tmdb:movie:' : 'tmdb:tv:';
  const format  = isMovie ? movieRecord : tvRecord;
  const append  = isMovie ? 'credits,release_dates,external_ids' : 'credits,content_ratings';

  const items = await candidates(kind, language);
  const refreshAfter = isoDay(-REFRESH_DAYS);
  const isFresh = item => (item.release_date || item.first_air_date || '') >= refreshAfter;

  console.log(`\n  ${language} ${isMovie ? 'movies' : 'series'}: ${items.length} on TMDB (recent + popular)`);
  if (DRY_RUN) {
    const newest = items
      .filter(isFresh)
      .sort((a, b) => (b.release_date || b.first_air_date || '').localeCompare(a.release_date || a.first_air_date || ''))
      .slice(0, 12);
    for (const item of newest) console.log(`    ${item.release_date || item.first_air_date}  ${item.title || item.name}`);
    return;
  }

  const have = await existingKeys(supabase, table, items.map(item => `${prefix}${item.id}`));
  const toFetch = items.filter(item => !have.has(`${prefix}${item.id}`) || isFresh(item));
  console.log(`  ${items.length - have.size} new, ${toFetch.length} to fetch (new + released in the last ${REFRESH_DAYS} days)`);

  let upserted = 0, skipped = 0;
  const pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: 'source_key', ignoreDuplicates: false });
    if (error) throw error;
    upserted += batch.length;
  };
  for (const item of toFetch) {
    try {
      const details = await tmdbFetch(`/${kind}/${item.id}`, { append_to_response: append });
      await sleep(API_DELAY);
      const record = details ? format(details) : null;
      if (!record) { skipped++; continue; }
      pending.push(record);
      if (pending.length >= UPSERT_SIZE) await flush();
      process.stdout.write(`\r  ${upserted + pending.length} saved  ${skipped} skipped`);
    } catch {
      skipped++;
    }
  }
  await flush();
  console.log(`\r  ✓ ${upserted} saved  ${skipped} skipped`);
}

async function main() {
  const { TMDB_API_KEY } = process.env;
  if (!TMDB_API_KEY || (!DRY_RUN && !(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED))) {
    console.error('❌  Missing env vars: TMDB_API_KEY, Neon DATABASE_URL');
    process.exit(1);
  }
  const supabase = DRY_RUN ? null : createCatalogClient();
  console.log(`binge. language sync: ${LANGUAGES.join(', ')} · type ${TYPE} · last ${YEARS} years + ${POPULAR_PAGES} popular pages${DRY_RUN ? ' · DRY RUN' : ''}`);
  try {
    for (const language of LANGUAGES) {
      if (TYPE === 'movie' || TYPE === 'both') await syncKind(supabase, 'movie', language);
      if (TYPE === 'tv' || TYPE === 'both') await syncKind(supabase, 'tv', language);
    }
  } catch (err) {
    console.error('\n❌ Fatal:', err.message);
    process.exit(1);
  }
}

main();
