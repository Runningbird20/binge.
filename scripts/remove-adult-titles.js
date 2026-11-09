#!/usr/bin/env node
/**
 * remove-adult-titles.js
 *
 * Deletes every catalog movie and series that TMDB flags as adult. The syncs
 * skip adult titles, but older imports didn't, and 57 were still in the
 * catalog on 2026-11-06 (found by a user on the TV). TMDB publishes the full
 * list of adult ids every day; this downloads today's (or yesterday's) and
 * removes any catalog row whose source_key is on it, plus its cached ratings.
 * Runs after each catalog sync (sync-tmdb.yml), so nothing comes back.
 *
 *   node scripts/remove-adult-titles.js            # delete
 *   DRY_RUN=1 node scripts/remove-adult-titles.js  # list what would go
 *
 * Needs TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN).
 */

'use strict';

try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local'), quiet: true });
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
} catch {}

const zlib = require('zlib');
const { createClient } = require('@libsql/client');

const DRY_RUN = process.env.DRY_RUN === '1';
const BATCH = 400;

function exportDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}_${pad(d.getUTCDate())}_${d.getUTCFullYear()}`;
}

// TMDB's daily export of adult ids ("adult_movie_ids" / "adult_tv_series_ids").
async function adultIds(file) {
  for (const daysAgo of [0, 1, 2]) {
    const res = await fetch(`http://files.tmdb.org/p/exports/${file}_${exportDate(daysAgo)}.json.gz`);
    if (!res.ok) continue;
    const text = zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
    const ids = text.split('\n').filter(Boolean).map((line) => JSON.parse(line).id);
    if (ids.length > 1000) return ids;
  }
  throw new Error(`Couldn't download TMDB's ${file} export`);
}

async function purge(db, table, kind, ids) {
  const found = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const keys = ids.slice(i, i + BATCH).map((id) => `tmdb:${kind}:${id}`);
    const { rows } = await db.execute({
      sql: `select id, title, source_key from ${table} where source_key in (${keys.map(() => '?').join(',')})`,
      args: keys,
    });
    found.push(...rows);
  }
  console.log(`${table}: ${found.length} adult title${found.length === 1 ? '' : 's'}${DRY_RUN ? ' (dry run)' : ''}`);
  found.slice(0, 80).forEach((row) => console.log(`  ${row.id}  ${String(row.title).slice(0, 90)}`));
  if (DRY_RUN || !found.length) return found.length;
  for (let i = 0; i < found.length; i += BATCH) {
    const chunk = found.slice(i, i + BATCH);
    await db.batch([
      { sql: `delete from ${table} where id in (${chunk.map(() => '?').join(',')})`, args: chunk.map((row) => row.id) },
      { sql: `delete from title_ratings where source_key in (${chunk.map(() => '?').join(',')})`, args: chunk.map((row) => row.source_key) },
    ], 'write');
  }
  return found.length;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('Set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN).');
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
  const movies = await purge(db, 'movies', 'movie', await adultIds('adult_movie_ids'));
  const shows = await purge(db, 'tv_shows', 'tv', await adultIds('adult_tv_series_ids'));
  const total = movies + shows;
  console.log(`${DRY_RUN ? 'Would remove' : 'Removed'} ${total} adult title${total === 1 ? '' : 's'}.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
