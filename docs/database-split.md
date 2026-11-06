# Database ownership

**Turso is the media catalog. Supabase is accounts and user data.** Nothing is
stored in both. (The catalog moved from Neon Postgres to Turso on 2026-11-04.)

| Turso (media only) | Supabase (accounts + user data) |
| --- | --- |
| movies, tv_shows, books | Auth (users, passwords, recovery, sessions) |
| movie_genres, tv_show_genres, book_genres (views over catalog_genres) | profiles, account_profiles, profile PINs |
| title_ratings, episode_ratings_cache, subtitle_cache | watchlist, ratings, continue_watching, episode_progress |
| catalog search (`server/catalogSearch.js` + the `*_fts` trigram tables), catalog_stats | everything else user-owned or operational (shares, teams, fantasy, reminders, push, reports, markers, server config/status, announcements, errors), admin_stats and the collaborative_* RPCs |

## How clients reach each

- **Web:** `src/utils/supabase.js` exports a split client (`splitDatabaseClient`
  in `src/utils/mediaDatabase.js`). `.from()` on a media table and
  `rpc('search_catalog')` go to `POST /api/catalog/query|rpc`; everything else
  is the real Supabase client. Database credentials never reach the browser.
- **Server:** `server/data-access/client.js` gives the same split
  (`createHybridClient`); trusted server code may write the cache tables.
  `server/catalogDb.js` is the Turso connection (`TURSO_DATABASE_URL`,
  `TURSO_AUTH_TOKEN`); `server/data-access/query.js` turns PostgREST-shaped
  specs into SQLite SQL, keeping PostgREST's behaviour (NULL ordering, `*`
  wildcards, JSON columns parsed, numbers as numbers).
- **Apple TV / Fire TV:** `GET` on a media table goes to
  `{site}/api/catalog/rest/{table}` (PostgREST-style, read-only, no Supabase
  credentials sent); every other request goes to Supabase.
- `/api/catalog` (`server/routes/catalog.js`) only serves the media tables and
  rejects writes. Its Neon-era name, `/api/neon-data`, was dropped in 2026-11:
  TV builds from before then get no catalog and need reinstalling.

Catalog ids are shared: Supabase user rows refer to catalog ids (`media_id`), so
anything that needs a title name next to user data (e.g. the admin overview's
top titles) looks the ids up in the catalog.

## Cost: Turso bills rows scanned

The free plan includes 500M rows read and 10M rows written a month, and a
"row read" is a row *scanned*: an unindexed query over movies costs ~185k
reads. So:

- every query the app runs has an index (`turso/schema.sql`); check new ones
  with `CATALOG_DEBUG=plan` on the server (logs each plan, `FULL SCAN` = one
  read per row);
- genre lists and row counts are stored (`catalog_genres`, `catalog_stats`)
  and rebuilt by `node scripts/turso-catalog.js refresh`, the last step of
  each sync workflow;
- exact filtered counts (the Books page's per-genre counts) are computed once,
  stored in `catalog_stats` as `count:<hash>` and cleared by `refresh`;
- search uses the trigram FTS tables and fetches candidates by id;
- random windows (the Books shelf, `sampleCatalogForRecommendations`) start at
  a random id (`fetchRandomIdWindow` in `src/utils/catalogQueries.js`), never
  a random `OFFSET`, which reads every skipped row.

Measured on Turso at the switch (rows read per visit): Movies or Series page a
few hundred, a grid page ~60 per query, Books ~1,900 (was ~72,000 with
offsets), an uncached search ~1–15k (cached 10 min). The one-time load wrote
~4M rows (search and other indexes count too).

## Keeping it split

`.github/workflows/database-split.yml` runs every Monday (or Actions → Database
split → Run workflow). It checks that the deployed site answers
`/api/catalog/rest/movies`, then runs `scripts/check-database-split.js`
(Turso holds only the catalog, Supabase exposes none of it). A failed scheduled
run opens or updates an issue. Secrets: `TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. The catalog sync
workflows (`sync-tmdb.yml`, `sync-languages.yml`) and `catalog-health.yml` use
the two `TURSO_*` secrets.

## History

- **Oct 2026, Supabase → Neon:** the catalog tables, genre views and search
  RPCs were dropped from Supabase
  (`supabase/migrations/20261028160000_media_moves_to_neon.sql`) after a
  one-time copy (scripts and the Neon-side SQL are in git history). TV builds
  from before then read the Supabase catalog directly and show empty rows.
- **Nov 2026, Neon → Turso:** a one-time copy (read-only on the Neon side)
  moved every row, a verify step compared counts and sampled rows, and Neon's
  `search_catalog()` was ported to `server/catalogSearch.js` and benchmarked to
  the same ranks. The copy and Neon-comparison code were then removed (git
  history); nothing in the repo reads or syncs with Neon.

`supabase/repeatable_schema.sql` no longer creates catalog tables, and
`npm run supabase:seed:catalogs` is gone. Supabase Auth is the only sign-in:
the Neon Auth code paths and the legacy SQLite/JWT server were removed.
