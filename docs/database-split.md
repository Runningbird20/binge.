# Database ownership

**Neon is the media catalog. Supabase is accounts and user data.** Nothing is
stored in both.

| Neon (media only) | Supabase (accounts + user data) |
| --- | --- |
| movies, tv_shows, books | Auth (users, passwords, recovery, sessions) |
| movie_genres, tv_show_genres, book_genres (views) | profiles, account_profiles, profile PINs |
| title_ratings, episode_ratings_cache, subtitle_cache | watchlist, ratings, continue_watching, episode_progress |
| search_catalog, fuzzy_search | everything else user-owned or operational (shares, teams, fantasy, reminders, push, reports, markers, server config/status, announcements, errors), admin_stats and the collaborative_* RPCs |

## How clients reach each

- **Web:** `src/utils/supabase.js` exports a split client (`splitDatabaseClient`
  in `src/utils/mediaDatabase.js`). `.from()` on a media table and
  `rpc('search_catalog')` go to `POST /api/neon-data/query|rpc`; everything else
  is the real Supabase client. Database credentials never reach the browser.
- **Server:** `server/data-access/client.js` gives the same split
  (`createHybridClient`); trusted server code may write the cache tables.
  `server/neonDb.js` returns bigint/numeric as numbers, like PostgREST.
- **Apple TV / Fire TV:** `GET` on a media table goes to
  `{site}/api/neon-data/rest/{table}` (PostgREST-style, read-only, no Supabase
  credentials sent); every other request goes to Supabase.
- `/api/neon-data` only serves the media tables, rejects writes, and turns
  PostgREST `*` wildcards into `%`.

Catalog ids are shared: Supabase user rows refer to Neon ids (`media_id`), so
anything that needs a title name next to user data (e.g. the admin overview's
top titles) looks the ids up in Neon.

## Keeping it split

`.github/workflows/database-split.yml` runs every Monday (or Actions → Database
split → Run workflow). It checks that the deployed site answers
`/api/neon-data/rest/movies`, then runs `scripts/check-database-split.js`
(Neon holds only the catalog, Supabase exposes none of it). A failed scheduled
run opens or updates an issue. Secrets: `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`. Catalog sync workflows (`sync-tmdb.yml`,
`sync-languages.yml`) write to Neon with `DATABASE_URL` only.

## How the duplicates were removed (done, Oct 2026)

One-time migration, run from that workflow's former "apply" mode (removed
2026-11-04, see git history): copy any catalog rows Neon was missing
(`scripts/migrate-media-to-neon.js`), check every Supabase catalog id exists in
Neon (`scripts/verify-media-migration.js`), back Neon up as a branch, then
- `neon/media_only.sql`: drops Neon's copies of user tables, user functions
  and the copied `auth`/`storage`/`realtime`/… schemas plus `neon_auth`;
  aborts if any catalog count changes;
- `supabase/migrations/20261028160000_media_moves_to_neon.sql`: rewrites
  `admin_stats` without the media join, drops the catalog tables, genre views
  and search RPCs from Supabase.

Both SQL files are idempotent. TV builds from before the split read the
Supabase catalog directly and show empty rows; they need updating.

`supabase/repeatable_schema.sql` no longer creates catalog tables, and
`npm run supabase:seed:catalogs` is gone. Supabase Auth is the only sign-in:
the Neon Auth code paths and the legacy SQLite/JWT server were removed.
