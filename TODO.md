# TODO

Ideas for binge., roughly in priority order. Each item names the files to start from.

## Fix first

- [ ] **Install the new TV builds.** TV apps from before the split read the catalog from Supabase, which no longer has it, so their rows are empty. Fire TV: the APK from the latest `tv-apk.yml` run. Apple TV: build and install from Xcode.

## Code clean up

- [x] **Delete the components nothing uses.** No file imports `HlsPlayer.js`, `MediaRow.js` or `RatingBadge.js`, and `MediaCard.js` / `MobileMediaCard.js` only import each other (`TitleCard` replaced them). Delete them, their CSS (`mob-card-*` and friends in `mobile.css` / `App.css`) and the `hls.js` dependency, which only `HlsPlayer` used.
- [x] **Remove the dead server routes.** Nothing in the app calls `/api/watchroom`, `/api/weebcentral` or `/api/bato` (`server/routes/{watchroom,weebcentral,bato}.js`, plus their CSP entries in `server/app.js`), and `server/utils/supabaseClient.js` isn't required anywhere.
- [x] **Retire the Supabase catalog seed pipeline.** Supabase no longer holds the catalog, so `generate-supabase-{movie,tv,book}-seed.js`, `prepare-non-destructive-chunks.js`, `run_chunks.js`, `seed_split.js`, `import-books-to-supabase.js`, `supabase/repeatable_*_seed.sql` and `supabase/chunks*/` (174 MB) are dead, along with the `generate:supabase:*` / `prepare:supabase:chunks` npm scripts. Keep `run-supabase-sql.js` for the schema.
- [x] **Take generated data out of git.** `backups/` (264 MB catalog export, in Git LFS) and `data/` (146 MB scraper output) are now untracked and gitignored; the local copies stay, and the catalog lives in Neon with backup branches.
- [x] **Shrink the repo's history.** Done 2026-10-29: `data/`, `backups/`, `supabase/chunks*`, the seed SQL, committed `node_modules/` and `.codex-artifacts/` removed from every commit and all branches force-pushed; a fresh clone is 7 MB (was ~229 MB). Old history is in `~/binge-history-backup-2026-10-29.bundle`. Still to do on GitHub: delete the LFS objects (Settings → Git LFS / Archives), and ask GitHub Support to run a GC so old pull-request refs stop holding the old objects.
- [x] **One stylesheet layer instead of four.** `theme-experiment.css` is folded into `App.css` (same cascade order), 332 declarations that a later rule always overrode and 5 selectors for classes nothing sets are gone, and selectors restyled in more than one file dropped from 137 to 31. Computed styles of every element on 33 page/screen combinations (desktop, phone, TV mode) are identical before and after.
- [x] **Finish untangling the stylesheets** (investigated 2026-10-29; nothing more is safe to automate). The 50 `mobile.css` rules outside media queries are phone-only *components* (`.mp-*` player, `.bsheet-*` bottom sheet, `.ptr-*` pull-to-refresh), which render by device type (`useIsMobile`), not width, so a `max-width` query would break them on landscape phones and tablets: they stay. The `!important`s are deliberate: reduced motion (`animation-duration` on `*`), `prefers-contrast` colors, beating `ProfileAvatar`'s inline size, TV-mode focus rings, and turning desktop modals into phone sheets. A cascade-proof pass (only move or merge when no rule in between could hit the same element and property) cleared just 2–3 moves and ~10 merges, because many classes are set through variables or passed through components; the remaining 31 shared selectors are best merged by hand when someone is already editing that component.
- [ ] **Rename files whose names are out of date.** `scripts/sync-language-to-supabase.js` writes to Neon (`import:malayalam` too: it handles any language), `src/utils/supabaseMovieCatalog.js` reads Neon, Rename them and update imports, npm scripts, workflows and CLAUDE.md.
- [ ] **Delete one-off scripts.** `scripts/migrate-legacy-auth-users.js` (the old auth migration, done) and `scripts/script_parser.py` aren't referenced by any npm script, workflow or doc.
- [ ] **Review the lint suppressions.** 24 `react-hooks/exhaustive-deps` disables can hide stale-closure bugs (a hook reading an old profile or setting); fix the dependencies or leave a comment saying why each is safe. The 10 `no-await-in-loop` ones are deliberate (rate-limited APIs) and can stay.
- [ ] **Split `src/App.test.js`.** At 815 lines it tests routing plus the Movies, Series and Books pages. Move the page tests next to their pages (`Movies.test.js`, …) and keep `App.test.js` for routing.
- [ ] **Fix stale sections of CLAUDE.md.** "Desktop / mobile component pairs" still describes `MobileMediaDetail` / `MobileBookDetail` (removed) and the dead `MediaCard` pair, and contradicts the "Title / book detail modals" section above it. Re-check the rest against the code once the items above land.

## Catalog data

- [ ] **Fill in missing catalog fields.** In Neon, 44% of movies have no `vote_average`/`popularity` and 43% no `original_language`. `backfill-catalog-fields.js` does 1,000 rows per twice-weekly run, so it would take months to catch up. Run a one-off large backfill (or a nightly job with a higher `MAX_ROWS`), then rely on the twice-weekly run.

## Features

- [ ] **"Forgot PIN?"** on the lock screen: confirm the account password, then clear or reset the PIN (`ProfileSecurityDialog.js`; `set_profile_lock` already supports removing it).
- [ ] **Watch party / shared queue.** `profile_shares` already sends titles between profiles in an account; a "watch together" link that syncs play/pause through Supabase Realtime would build on it.
- [ ] **Smarter "Because you watched"** (on hold until binge. has enough users with overlapping ratings). Mix in the existing `collaborative_*_candidates` RPCs ("people who liked X also liked") as a lightly weighted extra source next to TMDB `/recommendations` (which already covers this from TMDB's audience) in `src/utils/personalization.js`.
- [ ] **Per-profile time limits for kids profiles** (daily minutes, bedtime), enforced where playback positions are already saved.
- [ ] **Offline-friendly lists.** The service worker already caches TMDB responses and art; cache My List and Continue Watching too so Home renders on a plane.
- [ ] **Where to watch.** Nothing calls TMDB's `/watch/providers`. Show the legal streaming/rent/buy options for the viewer's country on the title page (`MediaDetailsModal.js`, `useTitleDetails.js`); TMDB requires a JustWatch credit next to it.
- [ ] **Actor and director pages.** Search finds people (`searchPerson` in `src/utils/searchExtras.js`), but there's no `/person/:id` route, so you can't open someone's filmography. Add a page from TMDB `/person/{id}` + `combined_credits`, matched back to the catalog like the browse rows, and link the cast on title pages to it.
- [ ] **Mark a whole season watched.** Episodes are only marked one at a time as they play (`components/player/useWatchedEpisodes.js`). Add "Mark season watched" and "Watched up to here" to the episode list, writing `episode_progress`, so catching up on a show you saw elsewhere takes one click.
- [ ] **Reading progress across devices.** `BookReader.js` keeps your place in `localStorage` (`binge:reader-progress`), so it doesn't follow the profile to another device. Save it per profile in Supabase, like `continue_watching.position_seconds`.
- [ ] **"Surprise me."** A button on Home and Movies/Series that picks one title from the profile's top recommendations (`buildPersonalizedRows`), respecting the release window and maturity level, and opens or plays it.
- [ ] **Search filters.** `/search` (`SearchResults.js`) has no way to narrow results. Add chips for type, decade and language (`role="group"` + `aria-pressed`, like the genre chips), applied to both catalog results and Ask binge.
- [ ] **Sleep timer on the website.** The TV apps have one (`PlayerModel.swift`, `PlayerModel.kt`); the web player doesn't. "End of episode / 30 / 60 min" in `PlaybackOptions.js`, pausing via the same position save as closing the player.
- [ ] **Maturity levels on the TV apps.** The website has Toddler / Kids / Teens / No restrictions (`src/utils/kidsMode.js`), but the TV apps only read `is_kids` and apply the Kids list to every restricted profile. Read `settings.maturity` in `Models.swift` / `Models.kt`, extend `KidsFilter` with each level's ratings, and show the age pill on the TV profile pickers.

## UI and UX

- [ ] **Undo after removing something.** Removing a title from My List, Continue Watching or History happens instantly with no way back. `sonner` is already a dependency: show "Removed · Undo" for a few seconds and only then delete (`Home.js`, `Profile.js`, `History.js`).
- [ ] **Spoiler-safe episode lists.** Episode stills and summaries further ahead than your next episode give plot away. Blur those stills and hide those summaries until tapped, with a switch in Settings (`MediaDetailsModal.js`, `profileSettings.js`).
- [ ] **"Install binge." prompt.** The site is a PWA (manifest, service worker, shortcuts), but nothing handles `beforeinstallprompt`, so most people never install it. Offer Install in the Me sheet / Settings on Chrome and Android, and an "Add to Home Screen" how-to sheet on iPhone.
- [ ] **Link previews for shared titles.** `/movie/:id`, `/tv-show/:id` and `/book/:id` are rendered in the browser, so iMessage, Discord and Slack show the generic site card. Serve `og:title` / `og:description` / `og:image` (the TMDB backdrop) for those paths from a small Vercel function before the app loads.
- [ ] **Notification inbox.** New-episode, reminder, game and admin push alerts disappear once dismissed, and nothing in the app lists them. Add a bell in the navbar with the last 30 days of alerts (one table both crons write to), with unread dots.

## Accounts and privacy

- [ ] **Delete my account.** Account Settings has no delete; only admins can delete users (`/api/admin/users`). Add a self-service route that confirms the password and calls `auth.admin.deleteUser` (everything cascades from `auth.users`).
- [ ] **Download my data.** Export ratings, My List, history and episode progress as JSON plus a Letterboxd-style CSV, the mirror of `/import` (`historyImport.js` already knows the formats).
- [ ] **Two-step sign-in.** Supabase Auth supports TOTP authenticator apps, but nothing enrolls or challenges a factor. Add it to Account Settings and the login form, at least for admin accounts.

## GitHub Actions

- [ ] **Bundle size on PRs.** After `CI=true npm run build`, comment the gzipped size of `build/static/js/main.*.js` against `main`, so a heavy import gets noticed before it ships.
- [ ] **Tidy merged branches.** A weekly job that deletes remote branches already merged into `main`. Unmerged branches stay; it only lists them in the run summary.

## Tests and reliability

- [ ] **Unit tests for the untested utils.** 42 of 64 `src/utils` modules have no test file. Start with logic that silently changes what users see: `catalogLookup`, `browseRows`, `continueWatching`, `kidsMode`, `releaseCalendar`, `playbackPositions`, `newEpisodes`.
- [ ] **An E2E check for the database split.** Signed in, open Home and assert rows have titles: this would have caught the empty preview (`e2e/`, needs `E2E_EMAIL`/`E2E_PASSWORD`).
- [ ] **E2E for profile PINs** (set PIN → switch away → wrong PIN → right PIN) once a test account exists.
- [ ] **Watch `/api/neon-data` in production.** Log slow queries and errors to `error_events` so a broken catalog shows on `/admin` instead of as silently empty rows.
