#!/usr/bin/env node
/**
 * backfill-catalog-fields.js
 *
 * Fills original_language and age_rating on catalog rows that were imported
 * without them (sync-tmdb-to-supabase.js only enriches TMDB ids it hasn't
 * seen, so older rows never got these). Only empty columns are written;
 * most popular titles go first.
 *
 *   node scripts/backfill-catalog-fields.js            # both tables, up to 3000 rows per column
 *   TYPE=movie MAX_ROWS=500 node scripts/backfill-catalog-fields.js
 *   DRY_RUN=1 node scripts/backfill-catalog-fields.js  # print what would change
 *
 * Needs TMDB_API_KEY and Neon DATABASE_URL.
 * A title with no US certification keeps age_rating empty (kids profiles
 * leave unrated titles out, which is the safe side).
 */

'use strict';

try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch {}

const { createCatalogClient } = require('./neon-catalog-client');
const { tmdbFetch } = require('./sync-tmdb-to-supabase');

const TYPE = process.env.TYPE || 'both';
const MAX_ROWS = parseInt(process.env.MAX_ROWS || '3000', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
const CONCURRENCY = 3; // ~3 req/s, under TMDB's 40 per 10s
const PAGE = 1000;

function usMovieRating(d) {
  const us = (d.release_dates?.results || []).find(r => r.iso_3166_1 === 'US');
  return us?.release_dates?.find(r => r.certification)?.certification || null;
}

function usTvRating(d) {
  return (d.content_ratings?.results || []).find(r => r.iso_3166_1 === 'US')?.rating || null;
}

// One column at a time. Rows imported before the TMDB sync have no
// popularity; they're the older catalog (Fight Club…) and go first.
async function rowsToFill(supabase, table, column) {
  const rows = [];
  for (let from = 0; rows.length < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('id, title, source_key, original_language, age_rating')
      .like('source_key', 'tmdb:%')
      .is(column, null)
      .order('popularity', { ascending: false, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows.slice(0, MAX_ROWS);
}

async function fill(supabase, table, column) {
  const isMovie = table === 'movies';
  const rows = await rowsToFill(supabase, table, column);
  console.log(`\n${table}.${column}: ${rows.length} rows empty`);
  let updated = 0, unchanged = 0, failed = 0, done = 0;

  async function one(row) {
    const id = row.source_key.split(':').pop();
    try {
      const d = await tmdbFetch(`/${isMovie ? 'movie' : 'tv'}/${id}`, { append_to_response: isMovie ? 'release_dates' : 'content_ratings' });
      if (!d) { unchanged++; return; }
      const patch = {};
      if (!row.original_language && d.original_language) patch.original_language = d.original_language;
      const rating = isMovie ? usMovieRating(d) : usTvRating(d);
      if (!row.age_rating && rating) patch.age_rating = rating.trim();
      if (!Object.keys(patch).length) { unchanged++; return; }
      if (DRY_RUN) {
        console.log(`  would set ${row.title} → ${JSON.stringify(patch)}`);
      } else {
        // Only where still empty, so nothing set meanwhile is overwritten.
        for (const [column, value] of Object.entries(patch)) {
          const { error } = await supabase.from(table).update({ [column]: value }).eq('id', row.id).is(column, null);
          if (error) throw error;
        }
      }
      updated++;
    } catch (error) {
      failed++;
      if (failed <= 5) console.log(`\n  ✗ ${row.title}: ${error.message}`);
    } finally {
      done++;
      if (done % 50 === 0) process.stdout.write(`\r  ${done}/${rows.length}  ${updated} updated  ${unchanged} unchanged  ${failed} failed`);
    }
  }

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(one));
  }
  console.log(`\r  ✓ ${rows.length} checked  ${updated} ${DRY_RUN ? 'would update' : 'updated'}  ${unchanged} unchanged  ${failed} failed`);
}

async function main() {
  if (!process.env.TMDB_API_KEY || !(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED)) {
    console.error('Needs TMDB_API_KEY and Neon DATABASE_URL.');
    process.exit(1);
  }
  const supabase = createCatalogClient();
  for (const column of ['original_language', 'age_rating']) {
    if (TYPE !== 'tv') await fill(supabase, 'movies', column);
    if (TYPE !== 'movie') await fill(supabase, 'tv_shows', column);
  }
}

main().catch(error => { console.error(error); process.exit(1); });
