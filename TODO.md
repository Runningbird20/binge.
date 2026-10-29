# TODO

Ideas for binge., roughly in priority order. Each item names the files to start from.

## Fix first

- [x] **Profile PINs on the TV apps.** Locked profiles open without a PIN on Apple TV and Fire TV: neither app calls `verify_profile_pin` or `list_profile_locks`. Add the lock screen to the TV profile pickers (`tv-apple/BingeTV/App/AppModel.swift`, `tv-android/.../data/Supabase.kt` + the profile screen), with a 4-digit entry that works with the remote.
- [x] **Finish the database split.** Done 2026-10-29: Supabase holds no catalog tables, Neon holds only the catalog (backup of Neon's old user-data copy in `server/data/database-split-backups/`, gitignored).
- [ ] **Install the new TV builds.** TV apps from before the split read the catalog from Supabase, which no longer has it, so their rows are empty. Fire TV: the APK from the latest `tv-apk.yml` run. Apple TV: build and install from Xcode.

## Clean up

- [ ] **Remove the Neon Auth code paths.** Branches for `REACT_APP_AUTH_PROVIDER === 'neon'` in `server/routes/{watchlist,ratings,admin,auth}.js`, `server/neonAuth.js` and the auth half of `src/utils/neon.js` read user tables that the split removes from Neon.
- [ ] **Retire the SQLite fallback server.** `server/db.js` (better-sqlite3, ~800 lines) still backs 8 routes as a fallback that writes to `/tmp` on Vercel and loses data on every cold start. Media now comes from Neon and user data from Supabase, so these fallbacks can go, along with `bcryptjs`/`jsonwebtoken` if the legacy `/api/auth` goes too.
- [x] **Split the giant files.** `server/routes/media.js` (2,144 lines), `src/components/EmbedPlayer.js` (1,738) and `src/utils/supabaseData.js` (1,715) would be easier to change in smaller pieces, e.g. one module per server or per table.
- [x] **Trim the CSS.** `src/styles/App.css` is 10,211 lines, much of it from pages that no longer exist (e.g. the old Watch Room `wr-*` rules). Search for selectors no component uses and delete them. Also drop the global `h1 { white-space: nowrap; }` (App.css): it stops headings wrapping on phones, and the PIN screen already has to override it.
- [x] **Bump the GitHub Actions** (`actions/checkout`, `actions/setup-node`) to versions on Node 24 before GitHub's Node 20 removal, and pin `ubuntu-24.04` before `ubuntu-latest` moves to Ubuntu 26.

## Catalog data

- [ ] **Fill in missing catalog fields.** In Neon, 44% of movies have no `vote_average`/`popularity` and 43% no `original_language`. `backfill-catalog-fields.js` does 1,000 rows per twice-weekly run, so it would take months to catch up. Run a one-off large backfill (or a nightly job with a higher `MAX_ROWS`), then rely on the twice-weekly run.
- [x] **Search on Neon.** Search now goes through `/api/neon-data`. Look into Neon full-text or trigram ranking in `search_catalog` (typos, accents, "the" prefixes) and cache popular queries.

## Features

- [ ] **"Forgot PIN?"** on the lock screen: confirm the account password, then clear or reset the PIN (`ProfileSecurityDialog.js`; `set_profile_lock` already supports removing it).
- [ ] **Watch party / shared queue.** `profile_shares` already sends titles between profiles in an account; a "watch together" link that syncs play/pause through Supabase Realtime would build on it.
- [ ] **Smarter "Because you watched"** (on hold until binge. has enough users with overlapping ratings). Mix in the existing `collaborative_*_candidates` RPCs ("people who liked X also liked") as a lightly weighted extra source next to TMDB `/recommendations` (which already covers this from TMDB's audience) in `src/utils/personalization.js`.
- [ ] **Per-profile time limits for kids profiles** (daily minutes, bedtime), enforced where playback positions are already saved.
- [ ] **Offline-friendly lists.** The service worker already caches TMDB responses and art; cache My List and Continue Watching too so Home renders on a plane.

## GitHub Actions

- [x] **One required check on every PR.** `neon.yml` builds with `CI: false`, so warnings that fail the Vercel build (unused variables) still pass, and the server tests (`node --test server/data-access/*.test.js`) never run. Add a `ci.yml` that runs Jest, the server tests and `CI=true npm run build`, and make it required on `main`. Keep `neon.yml` for the Neon preview branch only.
- [x] **E2E against each Vercel preview.** Trigger on `deployment_status` (success) and run `npm run test:e2e` with `E2E_BASE_URL` set to the preview URL. That covers sign-up, play/resume, rating, the TV remote flow and the axe accessibility check. It needs `E2E_EMAIL`/`E2E_PASSWORD` for a test account and a Vercel protection-bypass secret, because previews sit behind Vercel login. An empty Home, like the one the preview showed this week, would fail it.
- [x] **Apple TV build and unit tests.** Fire TV has `tv-apk.yml`, but nothing builds the Apple TV app. On changes under `tv-apple/**`, run `xcodebuild build-for-testing` and `tv-apple/scripts/run-tests.sh` (unit suites, no network) on a `macos` runner with a tvOS simulator.
- [x] **Fire TV releases.** `tv-apk.yml` only runs on pushes and keeps the APK as a 90-day artifact. Also run it on PRs, and on a `tv-v*` tag attach the APK to a GitHub Release, so the stick always installs from the same stable link.
- [x] **Check Supabase has every migration.** The profile-lock migration sat unapplied until the PIN screen said "currently unavailable". On PRs touching `supabase/migrations/` and nightly, list the tables and RPCs Supabase exposes (`GET /rest/v1/` with the secret key, no DB URL needed) and fail if one a migration creates is missing.
- [x] **Weekly database-split audit.** Run `database-split.yml` in `audit` mode on a schedule, plus a check that Neon has no user tables and Supabase no catalog tables. Open an issue if it fails, so drift between the two databases gets noticed.
- [x] **Catalog health report.** A weekly job that writes to the run summary: row counts, how many movies lack `vote_average`/`popularity`/`original_language`, and how many of TMDB's trending titles match a catalog row (`catalogLookup.js`, normally ~95%). Fail below 90% so a broken sync shows up.
- [x] **Dependabot.** Add `.github/dependabot.yml` for npm (root and `scripts/`), Gradle (`tv-android`) and GitHub Actions, weekly and grouped, so updates arrive as a few PRs instead of piling up.
- [x] **Secret scanning.** Run gitleaks on PRs. Local `.env` files hold service keys, and `server/data/database-split-backups/` holds user emails; both are gitignored, but one bad `git add -f` would publish them.
- [ ] **Bundle size on PRs.** After `CI=true npm run build`, comment the gzipped size of `build/static/js/main.*.js` against `main`, so a heavy import gets noticed before it ships.
- [ ] **Tidy merged branches.** A weekly job that deletes remote branches already merged into `main`. Unmerged branches stay; it only lists them in the run summary.

## Tests and reliability

- [ ] **Unit tests for the untested utils.** 42 of 64 `src/utils` modules have no test file. Start with logic that silently changes what users see: `catalogLookup`, `browseRows`, `continueWatching`, `kidsMode`, `releaseCalendar`, `playbackPositions`, `newEpisodes`.
- [ ] **An E2E check for the database split.** Signed in, open Home and assert rows have titles: this would have caught the empty preview (`e2e/`, needs `E2E_EMAIL`/`E2E_PASSWORD`).
- [ ] **E2E for profile PINs** (set PIN → switch away → wrong PIN → right PIN) once a test account exists.
- [ ] **Watch `/api/neon-data` in production.** Log slow queries and errors to `error_events` so a broken catalog shows on `/admin` instead of as silently empty rows.
