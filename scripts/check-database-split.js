// Checks the database split hasn't drifted (docs/database-split.md). Read-only.
//   Neon:     only the media catalog (tables/views below), nothing else.
//   Supabase: none of those catalog objects exposed through its REST API.
// Exits 1 and lists the drift otherwise.
//
//   DATABASE_URL=… SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/check-database-split.js
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ path: '.env', quiet: true });
const fs = require('fs');
const { Client } = require('pg');

// Keep in sync with neon/media_only.sql and database-split.yml.
const MEDIA = [
  'movies', 'tv_shows', 'books',
  'movie_genres', 'tv_show_genres', 'book_genres',
  'title_ratings', 'episode_ratings_cache', 'subtitle_cache',
];

async function neonExtras() {
  const db = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and not (table_name = any($1)) order by 1`, [MEDIA],
    );
    return rows.map((row) => row.table_name);
  } finally {
    await db.end();
  }
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
  // search_catalog moved to Neon too.
  return [...MEDIA, 'rpc/search_catalog'].filter((name) => exposed.has(name));
}

async function main() {
  const [extras, catalog] = await Promise.all([neonExtras(), supabaseCatalog()]);
  const problems = [
    ...extras.map((name) => `Neon has a non-catalog table: ${name}`),
    ...catalog.map((name) => `Supabase still serves catalog object: ${name}`),
  ];
  const summary = problems.length
    ? `### Database split drift\n\n${problems.map((p) => `- ${p}`).join('\n')}\n`
    : '### Database split\n\nNeon holds only the catalog; Supabase holds no catalog objects.\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (problems.length) process.exit(1);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
