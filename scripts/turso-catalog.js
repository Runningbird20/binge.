#!/usr/bin/env node
// Turso catalog maintenance (the media catalog; Supabase keeps accounts).
//
//   node scripts/turso-catalog.js schema            create tables, indexes, FTS, triggers (idempotent)
//   node scripts/turso-catalog.js refresh           rebuild genre lists + row counts (run after syncs)
//   node scripts/turso-catalog.js rebuild-search    recompute search_* columns (after changing searchNorm)
//   node scripts/turso-catalog.js pull --db file:data/turso/catalog.db
//                                                   copy the Turso catalog into a local file for
//                                                   development (~310k rows read; resumes by id)
//
// Target: TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN), or --db file:data/turso/catalog.db
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local'), quiet: true });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');
const { searchColumns } = require('../server/catalogSearch');
const { applySchema: applyCatalogSchema } = require('../server/catalogSchema');

const TABLES = ['movies', 'tv_shows', 'books', 'title_ratings', 'episode_ratings_cache', 'subtitle_cache'];
const KEYS = { title_ratings: ['source_key'], episode_ratings_cache: ['imdb_id', 'season'], subtitle_cache: ['key'] };
const PAGE = 2000;
const ROWS_PER_INSERT = 200;

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};

function target() {
  const url = argValue('--db') || process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('Set TURSO_DATABASE_URL or pass --db file:data/turso/catalog.db');
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(path.resolve(url.slice(5))), { recursive: true });
  return createClient({ url, authToken: url.startsWith('file:') ? undefined : process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
}

async function applySchema(db) {
  const count = await applyCatalogSchema(db);
  console.log(`schema: ${count} statements applied`);
}

async function columnsOf(db, table) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.map((row) => row.name);
}

async function upsertRows(db, table, columns, rows) {
  const keys = KEYS[table] || ['id'];
  const statements = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    const chunk = rows.slice(i, i + ROWS_PER_INSERT);
    const args = [];
    const tuples = chunk.map((row) => `(${columns.map((c) => { args.push(row[c] ?? null); return '?'; }).join(',')})`);
    const updates = columns.filter((c) => !keys.includes(c)).map((c) => `"${c}" = excluded."${c}"`);
    statements.push({
      sql: `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(',')}) VALUES ${tuples.join(',')} ON CONFLICT (${keys.join(',')}) DO UPDATE SET ${updates.join(',')}`,
      args,
    });
  }
  if (statements.length) await db.batch(statements, 'write');
}

// Turso -> a local file (the target), resuming after the highest id it has.
async function pull(db) {
  const sourceUrl = process.env.TURSO_DATABASE_URL;
  if (!sourceUrl || sourceUrl.startsWith('file:')) throw new Error('pull copies TURSO_DATABASE_URL (the Turso database) into --db file:…');
  const source = createClient({ url: sourceUrl, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
  try {
    await applySchema(db);
    for (const table of TABLES) {
      const columns = await columnsOf(db, table);
      const select = columns.map((c) => `"${c}"`).join(',');
      let copied = 0;
      if (KEYS[table]) {
        const { rows } = await source.execute(`SELECT ${select} FROM ${table}`);
        await upsertRows(db, table, columns, rows);
        copied = rows.length;
      } else {
        let after = Number((await db.execute(`SELECT coalesce(max(id), -1) AS m FROM ${table}`)).rows[0].m);
        if (after >= 0) console.log(`${table}: resuming after id ${after}`);
        for (;;) {
          const { rows } = await source.execute({ sql: `SELECT ${select} FROM ${table} WHERE id > ? ORDER BY id LIMIT ${PAGE}`, args: [after] });
          if (!rows.length) break;
          await upsertRows(db, table, columns, rows);
          copied += rows.length;
          after = rows[rows.length - 1].id;
          process.stdout.write(`\r${table}: ${copied.toLocaleString()} copied`);
        }
      }
      console.log(`\r${table}: ${copied.toLocaleString()} copied      `);
    }
  } finally {
    source.close();
  }
  await refresh(db);
}

async function refresh(db) {
  const now = new Date().toISOString();
  // Stored filter counts (server/data-access/query.js exactCount) are stale
  // once a sync has changed the catalog.
  const statements = [{ sql: 'DELETE FROM catalog_genres' }, { sql: "DELETE FROM catalog_stats WHERE name LIKE 'count:%'" }];
  for (const table of ['movies', 'tv_shows', 'books']) {
    const r = await db.execute(`SELECT DISTINCT genre FROM ${table} WHERE genre IS NOT NULL`);
    const genres = new Set();
    for (const row of r.rows) for (const g of String(row.genre).split(',')) if (g.trim()) genres.add(g.trim());
    for (const genre of genres) statements.push({ sql: 'INSERT OR IGNORE INTO catalog_genres (kind, genre) VALUES (?, ?)', args: [table, genre] });
    const count = Number((await db.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    statements.push({ sql: 'INSERT INTO catalog_stats (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', args: [`${table}.rows`, count, now] });
    console.log(`${table}: ${count.toLocaleString()} rows, ${genres.size} genres`);
  }
  await db.batch(statements, 'write');
}

async function rebuildSearch(db) {
  for (const table of ['movies', 'tv_shows', 'books']) {
    const extra = table === 'books' ? ', author' : '';
    let after = -1; let done = 0;
    for (;;) {
      const r = await db.execute({ sql: `SELECT id, title${extra} FROM ${table} WHERE id > ? ORDER BY id LIMIT ${PAGE}`, args: [after] });
      if (!r.rows.length) break;
      const statements = r.rows.map((row) => {
        const cols = searchColumns(table, { title: row.title, ...(table === 'books' ? { author: row.author } : {}) });
        const names = Object.keys(cols);
        return { sql: `UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`, args: [...names.map((n) => cols[n]), row.id] };
      });
      await db.batch(statements, 'write');
      done += r.rows.length; after = r.rows[r.rows.length - 1].id;
      process.stdout.write(`\r${table}: ${done.toLocaleString()} reindexed`);
    }
    console.log('');
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'pull' && !String(argValue('--db') || '').startsWith('file:')) {
    throw new Error('pull needs a local target: --db file:data/turso/catalog.db');
  }
  const db = target();
  if (command === 'schema') await applySchema(db);
  else if (command === 'refresh') await refresh(db);
  else if (command === 'rebuild-search') await rebuildSearch(db);
  else if (command === 'pull') await pull(db);
  else { console.error('Usage: node scripts/turso-catalog.js schema|refresh|rebuild-search|pull [--db file:...]'); process.exitCode = 2; }
  db.close();
}

main().catch((err) => { console.error(`\n${err.message}`); process.exit(1); });
