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

## Removing the duplicates

`.github/workflows/database-split.yml` (Actions → Database split → Run workflow):

1. **audit** (any time): checks the deployed site answers
   `/api/neon-data/rest/movies`, copies any catalog rows Neon is missing
   (`scripts/migrate-media-to-neon.js`), and checks every Supabase catalog id
   exists in Neon (`scripts/verify-media-migration.js`).
2. **apply** with confirm `delete duplicates`: the audit, then a Neon backup
   branch (`before-database-split-<run id>`), then
   - `neon/media_only.sql`: drops Neon's copies of user tables, user functions
     and the copied `auth`/`storage`/`realtime`/… schemas plus `neon_auth`;
     aborts if any catalog count changes;
   - `supabase/migrations/20261028160000_media_moves_to_neon.sql`: rewrites
     `admin_stats` without the media join, drops the catalog tables, genre views
     and search RPCs from Supabase.

Both are idempotent. **Order matters:** deploy the web app first and ship TV
builds that read `/api/neon-data` (older TV builds read the Supabase catalog
directly and will show empty rows once it is gone).

Secrets: `DATABASE_URL`, `NEON_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`SUPABASE_DB_URL` (Supabase → Connect → Session pooler; the REST secret key
cannot run DDL). Catalog sync workflows (`sync-tmdb.yml`, `sync-languages.yml`)
write to Neon with `DATABASE_URL` only.

`supabase/repeatable_schema.sql` no longer creates catalog tables, and
`npm run supabase:seed:catalogs` is gone. `REACT_APP_AUTH_PROVIDER=supabase`;
the old Neon Auth code paths (`=neon`) expect user tables in Neon and no
longer work after the cleanup.
