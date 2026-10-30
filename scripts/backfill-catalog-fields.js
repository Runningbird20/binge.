#!/usr/bin/env node
/**
 * backfill-catalog-fields.js
 *
 * Fills popularity, vote_average, original_language and age_rating on
 * catalog rows that were imported without them (sync-tmdb-to-neon.js only
 * enriches TMDB ids it hasn't seen, so older rows never got these). One TMDB
 * request per row fills every empty column; columns that already have a
 * value are never touched.
 *
 * A row is picked while its popularity is empty, so each row is looked up
 * once: a title TMDB no longer has gets popularity 0 (sorts last, leaves the
 * queue), and a title nobody has voted on keeps vote_average empty (the app
 * hides ratings that aren't > 0). A title with no US certification keeps
 * age_rating empty (kids profiles leave unrated titles out, the safe side).
 *
 *   node scripts/backfill-catalog-fields.js              # both tables, up to 3000 rows each
 *   TYPE=movie MAX_ROWS=500 node scripts/backfill-catalog-fields.js
 *   MAX_ROWS=all CONCURRENCY=10 node scripts/backfill-catalog-fields.js   # the whole backlog
 *   DRY_RUN=1 MAX_ROWS=20 node scripts/backfill-catalog-fields.js         # print what would change
 *
 * Needs TMDB_API_KEY and Neon DATABASE_URL.
 */

'use strict';

try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local'), quiet: true });
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
} catch {}

const { Client } = require('pg');
const { tmdbFetch } = require('./tmdb-records');

const TYPE = process.env.TYPE || 'both';
const MAX_ROWS = process.env.MAX_ROWS === 'all' ? Infinity : parseInt(process.env.MAX_ROWS || '3000', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
// TMDB allows roughly 40-50 requests a second; tmdbFetch waits out any 429.
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '6', 10);
const BATCH = 500; // rows read and written per round trip

function usMovieRating(d) {
  const us = (d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'US');
  return us?.release_dates?.find((r) => r.certification)?.certification || null;
}

function usTvRating(d) {
  return (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'US')?.rating || null;
}

// What TMDB knows about one row, as the values to fill (null = leave empty).
async function lookup(row, isMovie) {
  const id = row.source_key.split(':').pop();
  const d = await tmdbFetch(`/${isMovie ? 'movie' : 'tv'}/${id}`, { append_to_response: isMovie ? 'release_dates' : 'content_ratings' });
  if (!d) return { id: row.id, title: row.title, popularity: 0, vote_average: null, original_language: null, age_rating: null, gone: true };
  const rating = (isMovie ? usMovieRating(d) : usTvRating(d))?.trim() || null;
  return {
    id: row.id,
    title: row.title,
    popularity: Number.isFinite(d.popularity) ? d.popularity : 0,
    vote_average: d.vote_count > 0 && d.vote_average > 0 ? d.vote_average : null,
    original_language: d.original_language || null,
    age_rating: rating,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch (error) { out[i] = { error }; }
    }
  }));
  return out;
}

async function fill(db, table) {
  const isMovie = table === 'movies';
  const { rows: [{ count }] } = await db.query(
    `select count(*)::int as count from public.${table} where source_key like 'tmdb:%' and popularity is null`,
  );
  const total = Math.min(count, MAX_ROWS);
  console.log(`\n${table}: ${count} rows without popularity; checking ${total}`);
  let checked = 0, filled = 0, gone = 0, failed = 0, lastId = 0;
  const started = Date.now();

  while (checked < total) {
    const { rows } = await db.query(
      `select id, title, source_key from public.${table}
       where source_key like 'tmdb:%' and popularity is null and id > $1
       order by id limit $2`,
      [lastId, Math.min(BATCH, total - checked)],
    );
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;

    const results = await mapLimit(rows, CONCURRENCY, (row) => lookup(row, isMovie));
    const ok = results.filter((r) => r && !r.error);
    failed += results.length - ok.length;
    results.filter((r) => r?.error).slice(0, 3).forEach((r) => console.log(`\n  ✗ ${r.error.message}`));
    gone += ok.filter((r) => r.gone).length;

    if (DRY_RUN) {
      ok.slice(0, 8).forEach((r) => console.log(`  would set ${r.title} → ${JSON.stringify({ popularity: r.popularity, vote_average: r.vote_average, original_language: r.original_language, age_rating: r.age_rating })}`));
    } else if (ok.length) {
      // One statement per batch; coalesce keeps any value set meanwhile.
      const values = [];
      const params = [];
      ok.forEach((r, i) => {
        const b = i * 5;
        values.push(`($${b + 1}::bigint, $${b + 2}::numeric, $${b + 3}::numeric, $${b + 4}::text, $${b + 5}::text)`);
        params.push(r.id, r.popularity, r.vote_average, r.original_language, r.age_rating);
      });
      const result = await db.query(
        `update public.${table} t set
           popularity = coalesce(t.popularity, v.popularity),
           vote_average = coalesce(t.vote_average, v.vote_average),
           original_language = coalesce(nullif(t.original_language, ''), v.original_language),
           age_rating = coalesce(nullif(t.age_rating, ''), v.age_rating)
         from (values ${values.join(', ')}) as v(id, popularity, vote_average, original_language, age_rating)
         where t.id = v.id`,
        params,
      );
      filled += result.rowCount;
    }
    checked += rows.length;
    const rate = checked / ((Date.now() - started) / 1000);
    process.stdout.write(`\r  ${checked}/${total}  ${filled} filled  ${gone} gone from TMDB  ${failed} failed  ${rate.toFixed(1)}/s`);
  }
  console.log(`\n  ✓ ${checked} checked, ${DRY_RUN ? 'dry run' : `${filled} filled`}, ${gone} no longer on TMDB, ${failed} failed`);
}

async function main() {
  if (!process.env.TMDB_API_KEY || !(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED)) {
    console.error('Needs TMDB_API_KEY and Neon DATABASE_URL.');
    process.exit(1);
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    if (TYPE !== 'tv') await fill(db, 'movies');
    if (TYPE !== 'movie') await fill(db, 'tv_shows');
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
