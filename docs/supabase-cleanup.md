> Superseded by [database-split.md](database-split.md): the user now wants all user data retained in Supabase. Do not execute the cleanup plan below.

# Supabase cleanup audit

Requested end state: Neon stores application data; Supabase retains Auth and
profile PINs. No remote data has been deleted.

## Keep

- The `auth` schema, users, sessions, Auth configuration, and email recovery.
- `public.profiles`: AuthContext resolves account details and privileges here.
- `public.account_profiles`: profile selection and the profile-lock foreign key.
- `public.profile_locks` and its set/list/verify functions once installed via
  `20261028120000_profile_locks.sql`.
- Signup/default-profile triggers and functions used by those tables.
- Avatar storage and storage metadata while the kept profiles reference it.

## Blockers before deleting application data

The frontend still selects Supabase when Supabase Auth is configured:
`src/utils/supabaseData.js` directly reads/writes watchlist, numerical ratings,
continue_watching, episode_progress, and recommendation_hidden. Catalog access
also uses `src/utils/supabaseMovieCatalog.js`; `src/utils/supabaseApi.js` routes
application requests to Supabase. Configuring Neon routes alone does not switch
these callers. Auth configuration must be separated from application data
routing before cleanup.

Neon was inspected read-only and has matching catalog/profile/history tables,
but their presence does not verify that all rows have been migrated. Compare
record counts and user/profile ownership, reconcile any missing records, and
verify reads/writes through Neon before removing source data.

No Supabase database URL or management token is configured locally. The
installed CLI also has no authenticated session. Configure SUPABASE_DB_URL or
Supabase CLI login before inventorying dependencies and executing cleanup.

## Execution order

1. Inventory Supabase objects and establish a restorable backup of data to remove.
2. Compare source data with Neon and migrate any missing rows, preserving IDs.
3. Switch application-data callers to Neon while retaining Supabase Auth and PIN RPCs.
4. Verify profile selection, kids filtering, catalog search, ratings, watchlists,
   playback progress, and user-specific data isolation.
5. Install and verify the profile-lock migration in Supabase.
6. Remove only explicitly inventoried application objects, with dependencies
   checked against the keep list; do not drop the public/auth/storage schemas
   or use broad CASCADE deletion.
