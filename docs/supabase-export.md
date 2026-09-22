# Supabase export and migration inventory

The site still uses Supabase. Exporting data does not disconnect it or replace authentication. Do not remove the project or its credentials until the export and replacement have been restored and tested.

## Export commands

Set the following in `.env.local` (never in a `REACT_APP_` variable):

```dotenv
SUPABASE_DB_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_SIDE_SERVICE_ROLE_KEY
```

Use the direct database endpoint or the **session** pooler, not transaction pooling on port 6543. Keep the existing `REACT_APP_SUPABASE_URL`, or set `SUPABASE_URL` to the same project's HTTPS URL. Passwords in connection URLs must be URL encoded. The database role needs access to all application, auth and storage tables, bypassing RLS. The export explicitly disables row filtering so insufficient access fails rather than producing a silently incomplete backup.

Run:

```sh
npm run export:supabase
```

The PostgreSQL client tools must support the server's version (the repository's linked-project metadata says PostgreSQL 17). Override `PG_DUMP_BIN` and `PG_RESTORE_BIN` if needed. The exporter only reads Supabase; `pg_dump` and the JSONL tables share one repeatable-read snapshot. Counts are checked against that same snapshot.

Each run creates a new private directory under `backups/`, excluded from Git and Vercel uploads:

- `database.dump`: custom-format archive of application, auth and storage schemas, data, sequences, constraints, functions, views and triggers; ownership/ACL restoration is omitted.
- `schema.sql`: schema extracted from that archive for migration review.
- `columns.json`: live column definitions for conversion tooling.
- `tables/*.jsonl`: every row from each included table, preserving original IDs and native JSON values. `manifest.json` maps hashed filenames to table names.
- `storage/*`: actual object bytes, not just bucket/object metadata. The manifest maps files to original bucket/object names, records sizes and SHA-256 hashes.
- `manifest.json`: table counts, checksums, included/excluded schemas, status and limitations. A failed run keeps its partial files and remains `complete: false`.

`complete: true` covers the selected database schemas and downloaded storage objects; it does **not** certify that a replacement backend can run the site. Platform-managed schemas are listed separately in the manifest. Review any custom usage of Vault, cron, Realtime, extensions or database webhooks. Managed settings, OAuth/SMTP credentials and deployed edge functions are separate from table data. External TMDB/Open Library/Plex images and media embeds are references, not copied media files.

The database snapshot and object storage are not atomic together. Stop writes for the final migration export, verify storage files, then restore and test before switching traffic. Password hashes/auth records are sensitive: keep backups private and outside web assets. A SHA-256 checksum detects subsequent corruption, not source authenticity.

For an additional catalog-only copy:

```sh
npm run export:supabase:public
```

This uses bounded keyset pagination and retries, but is **always marked incomplete**: RLS may hide rows, concurrent edits can change the result, and private data/auth/schema/storage are absent. It is not sufficient for migration.

## Application dependencies found in this repository

| Area | Required data or replacement |
| --- | --- |
| Catalog | `movies`, `tv_shows`, `books`; all columns, original IDs, source keys and external IDs |
| Browse filters | `movie_genres`, `tv_show_genres`, `book_genres` views and their SQL definitions |
| Accounts | `auth.users`, auth identities and other auth tables; `profiles`; password/session/email flows |
| Household profiles | `account_profiles`, including default/kids settings and existing profile relationships |
| Ratings | `movie_ratings`, `tv_show_ratings`, `book_ratings`, including category scores and reviews |
| Library and progress | `watchlist`, `episode_progress`, `continue_watching` |
| Avatars | `storage.buckets`, `storage.objects` plus the bytes in the `avatars` bucket; rewrite saved avatar URLs after migration |
| Social/backend routes | Both `follows` and `user_follows` appear in repository sources/schema history; live schema inventory determines what exists. Also notifications, watch rooms, room messages/viewers |
| Historical/optional features | Lists, collaborators, votes, comments, media requests, forums/posts, todos, chatbot data and other tables discovered in the live schemas |
| Access control | RLS policies, auth-linked triggers/functions and server role checks must be replaced or adapted |

The exporter discovers live tables rather than assuming old migrations list everything. `auth.users` must be present or the export fails.

## Why removing environment variables is insufficient

`src/utils/supabaseData.js`, `supabaseMovieCatalog.js`, `supabaseApi.js`, `recommendations.js` and `src/contexts/AuthContext.js` call Supabase directly. Several Express routes also rely on Supabase. The older `server/db.js` SQLite database uses a different schema and writes to `/tmp` on Vercel, so it cannot preserve production account changes there.

Choose replacement hosting after the export. Keep existing UUIDs, media IDs and relationships when importing; adapt browser requests to the new API, replace Auth and storage, and verify profile isolation, kids filtering, sign-in, ratings, library/progress, recommendations, social and admin operations.

A raw archive retains Supabase dependencies and is not a turnkey plain-Postgres restore. Review `schema.sql`, create/adapt required roles and extensions, replace `auth.uid()`/auth-linked triggers as appropriate, and test in an isolated database. No restore/import command is run by the exporter.

References: [Supabase backups](https://supabase.com/docs/guides/platform/backups) (database backups exclude stored object bytes), [restore from hosted Supabase](https://supabase.com/docs/guides/self-hosting/restore-from-platform) (platform schema dependencies and separate storage transfer).
