// Weekly catalog health report (catalog-health.yml). Read-only.
//   - row counts for movies / tv_shows / books in Neon
//   - how many movies and shows lack vote_average / popularity / original_language
//   - coverage: how many of TMDB's trending titles (this week, movies + series,
//     the ones the browse rows would show) match a catalog row by source_key,
//     the same match catalogLookup.js uses. Normally ~95%.
// Writes a Markdown table to the run summary and exits 1 below MIN_COVERAGE
// (default 90%), so a broken sync shows up.
//
//   DATABASE_URL=… TMDB_API_KEY=… node scripts/catalog-health.js
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ path: '.env', quiet: true });
const fs = require('fs');
const { Client } = require('pg');

const MIN_COVERAGE = Number(process.env.MIN_COVERAGE || 90);
const TRENDING_PAGES = 3; // 20 titles a page
const COMING_SOON_DAYS = 30; // releaseWindow.js: later releases are hidden anyway

async function tmdb(path, page) {
  const key = process.env.TMDB_API_KEY || process.env.REACT_APP_TMDB_API_KEY;
  if (!key) throw new Error('TMDB_API_KEY is required');
  const response = await fetch(`https://api.themoviedb.org/3/${path}?api_key=${key}&page=${page}`);
  if (!response.ok) throw new Error(`TMDB ${path} answered ${response.status}`);
  return response.json();
}

// Trending titles a browse row could show: released, or out within 30 days.
async function trending(kind) {
  const cutoff = new Date(Date.now() + COMING_SOON_DAYS * 86400000).toISOString().slice(0, 10);
  const results = [];
  for (let page = 1; page <= TRENDING_PAGES; page += 1) {
    results.push(...(await tmdb(`trending/${kind}/week`, page)).results);
  }
  const seen = new Set();
  return results.filter((item) => {
    const date = item.release_date || item.first_air_date;
    if (!date || date > cutoff || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

const pct = (part, whole) => (whole ? (100 * part) / whole : 0);
const fmt = (n) => n.toLocaleString('en-US');

async function main() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    const counts = {};
    for (const table of ['movies', 'tv_shows', 'books']) {
      counts[table] = Number((await db.query(`select count(*) from public.${table}`)).rows[0].count);
    }

    const gaps = {};
    for (const table of ['movies', 'tv_shows']) {
      gaps[table] = (await db.query(`
        select count(*) filter (where vote_average is null) as vote_average,
               count(*) filter (where popularity is null) as popularity,
               count(*) filter (where original_language is null or original_language = '') as original_language
        from public.${table}`)).rows[0];
    }

    const coverage = {};
    for (const [kind, table, type] of [['movie', 'movies', 'movie'], ['tv', 'tv_shows', 'tv']]) {
      const items = await trending(kind);
      const keys = items.map((item) => `tmdb:${type}:${item.id}`);
      const found = new Set((await db.query(
        `select source_key from public.${table} where source_key = any($1)`, [keys],
      )).rows.map((row) => row.source_key));
      coverage[table] = {
        matched: keys.filter((key) => found.has(key)).length,
        total: keys.length,
        missing: items.filter((item, i) => !found.has(keys[i])).map((item) => `${item.title || item.name} (${item.id})`),
      };
    }

    const allMatched = coverage.movies.matched + coverage.tv_shows.matched;
    const allTotal = coverage.movies.total + coverage.tv_shows.total;
    const overall = pct(allMatched, allTotal);
    const ok = overall >= MIN_COVERAGE;

    const gapRow = (table, column) => `${fmt(Number(gaps[table][column]))} (${pct(Number(gaps[table][column]), counts[table]).toFixed(0)}%)`;
    const lines = [
      `## Catalog health ${ok ? '' : '— coverage below ' + MIN_COVERAGE + '%'}`.trim(),
      '',
      '| | Movies | Series | Books |',
      '|---|---|---|---|',
      `| Rows | ${fmt(counts.movies)} | ${fmt(counts.tv_shows)} | ${fmt(counts.books)} |`,
      `| No vote_average | ${gapRow('movies', 'vote_average')} | ${gapRow('tv_shows', 'vote_average')} | |`,
      `| No popularity | ${gapRow('movies', 'popularity')} | ${gapRow('tv_shows', 'popularity')} | |`,
      `| No original_language | ${gapRow('movies', 'original_language')} | ${gapRow('tv_shows', 'original_language')} | |`,
      `| TMDB trending in the catalog | ${coverage.movies.matched}/${coverage.movies.total} (${pct(coverage.movies.matched, coverage.movies.total).toFixed(0)}%) | ${coverage.tv_shows.matched}/${coverage.tv_shows.total} (${pct(coverage.tv_shows.matched, coverage.tv_shows.total).toFixed(0)}%) | |`,
      '',
      `Overall trending coverage: **${overall.toFixed(1)}%** (fails below ${MIN_COVERAGE}%).`,
    ];
    const missing = [...coverage.movies.missing, ...coverage.tv_shows.missing];
    if (missing.length) lines.push('', `Trending titles not in the catalog: ${missing.join(', ')}`);

    const report = lines.join('\n');
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
    if (!ok) process.exit(1);
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
