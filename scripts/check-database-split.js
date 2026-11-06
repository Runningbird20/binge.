// Checks the database split hasn't drifted (docs/database-split.md). Read-only.
//   Turso:    only the media catalog (tables/views below, their search
//             indexes and the genre/count tables), nothing else.
//   Supabase: none of those catalog objects exposed through its REST API.
// Exits 1 and lists the drift otherwise.
//
//   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/check-database-split.js
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ path: '.env', quiet: true });
const fs = require('fs');
const catalogDb = require('../server/catalogDb');

// Keep in sync with turso/schema.sql and MEDIA_TABLES in src/utils/mediaDatabase.js.
const MEDIA = [
  'movies', 'tv_shows', 'books',
  'movie_genres', 'tv_show_genres', 'book_genres',
  'title_ratings', 'episode_ratings_cache', 'subtitle_cache',
];
const CATALOG_INTERNAL = /^(catalog_genres|catalog_stats|(movies|tv_shows|books)_fts(_(data|idx|docsize|config))?)$/;
const ENGINE_INTERNAL = /^(sqlite_|libsql_|_litestream)/;

async function tursoExtras() {
  const { rows } = await catalogDb.query("SELECT name FROM sqlite_schema WHERE type IN ('table', 'view') ORDER BY name");
  return rows.map((row) => row.name)
    .filter((name) => !MEDIA.includes(name) && !CATALOG_INTERNAL.test(name) && !ENGINE_INTERNAL.test(name));
}

async function supabaseCatalog() {
  const url = (process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  });
  if (!response.ok) throw new Error(`Supabase GET /rest/v1/ answered ${response.status}`);
  const exposed = new Set(Object.keys((await response.json()).paths || {}).map((p) => p.slice(1)));
  return [...MEDIA, 'rpc/search_catalog'].filter((name) => exposed.has(name));
}

async function main() {
  const [extras, catalog] = await Promise.all([tursoExtras(), supabaseCatalog()]);
  const problems = [
    ...extras.map((name) => `Turso has a non-catalog table: ${name}`),
    ...catalog.map((name) => `Supabase still serves catalog object: ${name}`),
  ];
  const summary = problems.length
    ? `### Database split drift\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`
    : '### Database split\n\nTurso holds only the catalog; Supabase holds no catalog objects.\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (problems.length) process.exit(1);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
