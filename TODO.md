# TODO

Ideas for binge., roughly in priority order. Each item names the files to start from.

## Fix first

- [ ] **Install the new TV builds.** TV apps from before the split read the catalog from Supabase, which no longer has it, so their rows are empty. Fire TV: the APK from the latest `tv-apk.yml` run. Apple TV: build and install from Xcode.

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
