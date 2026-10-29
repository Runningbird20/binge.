# TODO

Ideas for binge., roughly in priority order. Each item names the files to start from.

## Fix first

- [ ] **Profile PINs on the TV apps.** Locked profiles open without a PIN on Apple TV and Fire TV: neither app calls `verify_profile_pin` or `list_profile_locks`. Add the lock screen to the TV profile pickers (`tv-apple/BingeTV/App/AppModel.swift`, `tv-android/.../data/Supabase.kt` + the profile screen), with a 4-digit entry that works with the remote.
- [ ] **Finish the database split.**
  1. Delete `REACT_APP_API_URL` from the Vercel project's environment variables.
  2. Make sure the Preview environment has `DATABASE_URL`.
  3. Deploy, then distribute the new TV builds.
  4. Add the `NEON_API_KEY` and `SUPABASE_DB_URL` secrets.
  5. Run **Actions → Database split**: first `audit`, then `apply`.

  See `docs/database-split.md`.
- [x] **Two workflows run the same TMDB sync at the same time.** `sync-tmdb.yml` and `sync-tmdb-neon.yml` both run `sync-tmdb-to-neon.js` Mon/Thu 09:00 UTC. Keep `sync-tmdb.yml` (it also backfills) and delete the other.
- [x] **Delete `docs/supabase-cleanup.md`.** It describes the opposite split and is marked superseded.

## Clean up

- [x] **Remove the Neon Auth code paths.** Branches for `REACT_APP_AUTH_PROVIDER === 'neon'` in `server/routes/{watchlist,ratings,admin,auth}.js`, `server/neonAuth.js` and the auth half of `src/utils/neon.js` read user tables that the split removes from Neon.
- [x] **Retire the SQLite fallback server.** `server/db.js` (better-sqlite3, ~800 lines) still backs 8 routes as a fallback that writes to `/tmp` on Vercel and loses data on every cold start. Media now comes from Neon and user data from Supabase, so these fallbacks can go, along with `bcryptjs`/`jsonwebtoken` if the legacy `/api/auth` goes too.
- [ ] **Split the giant files.** `server/routes/media.js` (2,144 lines), `src/components/EmbedPlayer.js` (1,738) and `src/utils/supabaseData.js` (1,715) would be easier to change in smaller pieces, e.g. one module per server or per table.
- [ ] **Trim the CSS.** `src/App.css` is 10,211 lines, much of it from pages that no longer exist (e.g. the old Watch Room `wr-*` rules). Search for selectors no component uses and delete them. Also drop the global `h1 { white-space: nowrap; }` (App.css): it stops headings wrapping on phones, and the PIN screen already has to override it.
- [ ] **Bump the GitHub Actions** (`actions/checkout`, `actions/setup-node`) to versions on Node 24 before GitHub's Node 20 removal, and pin `ubuntu-24.04` before `ubuntu-latest` moves to Ubuntu 26.

## Catalog data

- [ ] **Fill in missing catalog fields.** In Neon, 44% of movies have no `vote_average`/`popularity` and 43% no `original_language`. `backfill-catalog-fields.js` does 1,000 rows per twice-weekly run, so it would take months to catch up. Run a one-off large backfill (or a nightly job with a higher `MAX_ROWS`), then rely on the twice-weekly run.
- [ ] **Search on Neon.** Search now goes through `/api/neon-data`. Look into Neon full-text or trigram ranking in `search_catalog` (typos, accents, "the" prefixes) and cache popular queries.

## Features

- [ ] **"Forgot PIN?"** on the lock screen: confirm the account password, then clear or reset the PIN (`ProfileSecurityDialog.js`; `set_profile_lock` already supports removing it).
- [ ] **Ticket book on the TVs.** `/wrapped?view=book` is web only; the TV apps already have Wrapped tickets to build on.
- [ ] **Watch party / shared queue.** `profile_shares` already sends titles between profiles in an account; a "watch together" link that syncs play/pause through Supabase Realtime would build on it.
- [ ] **Smarter "Because you watched".** Mix in the existing `collaborative_*_candidates` RPCs ("people who liked X also liked") alongside TMDB recommendations in `src/utils/personalization.js`.
- [ ] **Per-profile time limits for kids profiles** (daily minutes, bedtime), enforced where playback positions are already saved.
- [ ] **Offline-friendly lists.** The service worker already caches TMDB responses and art; cache My List and Continue Watching too so Home renders on a plane.

## Tests and reliability

- [ ] **Unit tests for the untested utils.** 42 of 64 `src/utils` modules have no test file. Start with logic that silently changes what users see: `catalogLookup`, `browseRows`, `continueWatching`, `kidsMode`, `releaseCalendar`, `playbackPositions`, `newEpisodes`.
- [ ] **An E2E check for the database split.** Signed in, open Home and assert rows have titles: this would have caught the empty preview (`e2e/`, needs `E2E_EMAIL`/`E2E_PASSWORD`).
- [ ] **E2E for profile PINs** (set PIN → switch away → wrong PIN → right PIN) once a test account exists.
- [ ] **Watch `/api/neon-data` in production.** Log slow queries and errors to `error_events` so a broken catalog shows on `/admin` instead of as silently empty rows.
