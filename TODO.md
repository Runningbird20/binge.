# TODO

Ideas for binge., roughly in priority order. Each item names the files to start from.

## Features

- [ ] **"Forgot PIN?"** on the lock screen: confirm the account password, then clear or reset the PIN (`ProfileSecurityDialog.js`; `set_profile_lock` already supports removing it).
- [ ] **Watch party / shared queue.** `profile_shares` already sends titles between profiles in an account; a "watch together" link that syncs play/pause through Supabase Realtime would build on it.
- [ ] **Smarter "Because you watched"** (on hold until binge. has enough users with overlapping ratings). Mix in the existing `collaborative_*_candidates` RPCs ("people who liked X also liked") as a lightly weighted extra source next to TMDB `/recommendations` (which already covers this from TMDB's audience) in `src/utils/personalization.js`.
- [ ] **Reading progress across devices.** `BookReader.js` keeps your place in `localStorage` (`binge:reader-progress`), so it doesn't follow the profile to another device. Save it per profile in Supabase, like `continue_watching.position_seconds`.
- [ ] **Sleep timer on the website.** The TV apps have one (`PlayerModel.swift`, `PlayerModel.kt`); the web player doesn't. "End of episode / 30 / 60 min" in `PlaybackOptions.js`, pausing via the same position save as closing the player.

## UI and UX

- [ ] **"Install binge." prompt.** The site is a PWA (manifest, service worker, shortcuts), but nothing handles `beforeinstallprompt`, so most people never install it. Offer Install in the Me sheet / Settings on Chrome and Android, and an "Add to Home Screen" how-to sheet on iPhone.
- [ ] **Link previews for shared titles.** `/movie/:id`, `/tv-show/:id` and `/book/:id` are rendered in the browser, so iMessage, Discord and Slack show the generic site card. Serve `og:title` / `og:description` / `og:image` (the TMDB backdrop) for those paths from a small Vercel function before the app loads.
- [ ] **Notification inbox.** New-episode, reminder, game and admin push alerts disappear once dismissed, and nothing in the app lists them. Add a bell in the navbar with the last 30 days of alerts (one table both crons write to), with unread dots.

## Tests and reliability

- [ ] **Unit tests for the untested utils.** 42 of 64 `src/utils` modules have no test file. Start with logic that silently changes what users see: `catalogLookup`, `browseRows`, `continueWatching`, `kidsMode`, `releaseCalendar`, `playbackPositions`, `newEpisodes`.
- [ ] **An E2E check for the database split.** Signed in, open Home and assert rows have titles: this would have caught the empty preview (`e2e/`, needs `E2E_EMAIL`/`E2E_PASSWORD`).
- [ ] **E2E for profile PINs** (set PIN → switch away → wrong PIN → right PIN) once a test account exists.
- [ ] **Watch `/api/catalog` in production.** Log slow queries and errors to `error_events` so a broken catalog shows on `/admin` instead of as silently empty rows.

## Code cleanup and organization

- [ ] **Drop the old `/api/neon-data` path** (`server/app.js`, `server/routes/catalog.test.js`, and its probe in `database-split.yml`) once no TV build from before 2026-11 is installed. Everything else uses `/api/catalog`.
- [ ] **Lint the test files.** Nothing lints `src/**/*.test.js` or `e2e/`: `npx eslint src e2e` finds 77 problems (`testing-library/*` and `jest/*` rules, and `import/first` after the `jest.mock` calls; babel-jest hoists those anyway, so the imports can move up). Fix them, then add `src` and `e2e` to `npm run lint`.

## Mobile

The phone apps exist (`mobile-android/`, `mobile-ios/`; each builds with its own `scripts/build-apk.sh` / `scripts/build-ipa.sh`). Next:

- [ ] **Build them in CI.** A `tv-apk.yml`-style workflow for `mobile-android/` (reusing the `TV_DEBUG_KEYSTORE` signing), and an unsigned `.ipa` on a macOS runner, both attached to a GitHub Release on a `mobile-v*` tag.
- [ ] **A signed iPhone app.** Without an Apple Developer account the `.ipa` has to be re-signed with a personal Apple ID (installs expire after 7 days). A paid account can sign it (ad hoc / TestFlight) in `mobile-ios/scripts/build-ipa.sh` or CI.
- [ ] **Notifications in the apps.** Web push doesn't reach the web views. Register for FCM / APNs natively, and have the crons (`server/routes/cron.js`) send to those tokens as well as to `push_subscriptions`.
- [ ] **Open binge. links in the app.** Android needs `public/.well-known/assetlinks.json` (with the APK's signing fingerprint) and `autoVerify`. iOS needs Associated Domains (`apple-app-site-association`) and a signed build.