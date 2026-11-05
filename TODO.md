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
- [ ] **Watch `/api/neon-data` in production.** Log slow queries and errors to `error_events` so a broken catalog shows on `/admin` instead of as silently empty rows.

## Code cleanup and organization

- [ ] **Delete Express routes nothing calls.** Nothing in `src/`, `tv-apple/` or `tv-android/` uses `/api/embed-proxy` (`server/routes/embedProxy.js`), `/api/proxy` (`proxy.js`) or `/api/notifications` (`notifications.js`). Unmount them in `server/app.js` and delete the files.
- [ ] **Drop the "Supabase not configured" fallbacks.** `src/utils/data/{account,library,progress,shared}.js` carry 44 branches for running without Supabase: localStorage copies (`neon_account_profiles`) and calls to the old Express routes (`/watchlist`, `/ratings/my`, …). The app requires Supabase now, so every change has to keep paths working that never run. Remove them, and mock the client in any tests that lean on them. Then check whether `server/routes/{media,watchlist,ratings,profile,search}.js` still have callers.
- [ ] **One catalog page for Movies and TV.** `src/pages/Movies.js` and `TVShows.js` are about 780 lines each, and only about 80 lines differ once the movie/series names are swapped. Fold them into one page that takes `mediaType`, as `BrowseView` already does for the rows view. Keep `Movies.test.js` and `TVShows.test.js` passing.
- [ ] **One copy of the sports feed fetchers.** `fetchPpvNormalized`, `fetchStreamedNormalized`, `fetchStreamfreeNormalized` and `streamfreeLabel` are written twice, in `src/utils/sportsProviders.js` and `server/routes/sports.js`, and kept in sync by hand. Move them into one module both can load, e.g. an `.mjs` file under `src/` that the server `require`s (Node 24 can require ES modules).
- [ ] **Retire the ad blocker that can't reach the ads.** `components/AdBlocker.js` (with `utils/embedSecurity.js`) and the ad lists in `public/sw.js` only see binge.'s own requests, never the players' (cross-origin iframes). Their patterns can also block real requests: any path containing `/banner` or `/popup`, any host containing `onclick`. Pop-ups are handled by the sandbox now (`utils/popupSandbox.js`). Remove them, or keep one list rather than two.
- [ ] **Unused CSS.** About 120 class names in `src/styles/{App,streaming,mobile}.css` never appear in the JS.
  - Some are built at runtime (`profile-picker-age--${level}`), so check each one before deleting.
  - Others are leftovers from removed screens (`artifact-panel`, `foryou-grid`, `books-tab-bar` in `mobile.css`).
  - `App.css` defines `@keyframes skeleton-shimmer` twice.
  - Then split `streaming.css` (4,721 lines) by area: player, title popup, sports, profile.
- [ ] **Neon leftovers and stale settings.**
  - `/api/neon-data` kept its name for installed TV builds. Add an `/api/catalog` alias, move the website and both TV apps to it, and drop the old path once old builds are gone.
  - `docs/profile-locks.md` and `docs/password-reset.md` still mention "Neon Auth" accounts.
  - Nothing reads `REACT_APP_CHATBOT_*`, `REACT_APP_DEVLAB_API_*` or `TAVILY_API_KEY`, which are still in `.env.example` (and `REACT_APP_DEVLAB_API_MODE` in `vercel.json`).
- [ ] **Lint the server and scripts.** ESLint only runs inside `react-scripts build`/`test`, which never look at `server/`, `api/` or `scripts/`. Add `npm run lint` covering all of them, and run it in `.github/workflows/ci.yml`.
- [ ] **Rethink the 6.5 MB static catalog.** `public/catalog/*.bulk.jsonl` (5.2 MB of Internet Archive books, 1.3 MB of Plex movies and TV) ship with every deploy for `utils/catalogFallback.js`. With the catalog in Turso, decide whether the outage fallback earns its size, or cut it down to a small set.
- [ ] **Names that no longer fit.** `SkeletonCard`/`SkeletonGrid` (`components/SkeletonCard.js`) render `LoadingBar`, not skeletons. `server/routes/neonData.js` serves Turso. Rename them when you're next in those files.
- [ ] **Fire TV leftovers.** `PlaybackPrefs.trailers`, `AppModel.deepLink` and `QrCode` aren't used. The sign-in screen still mentions books, which the TV apps don't have.

## Mobile

The phone apps exist (`mobile-android/`, `mobile-ios/`; `scripts/build-apk.sh`, `scripts/build-ipa.sh`). Next:

- [ ] **Build them in CI.** A `tv-apk.yml`-style workflow for `mobile-android/` (reusing the `TV_DEBUG_KEYSTORE` signing), and an unsigned `.ipa` on a macOS runner, both attached to a GitHub Release on a `mobile-v*` tag.
- [ ] **A signed iPhone app.** Without an Apple Developer account the `.ipa` has to be re-signed with a personal Apple ID (installs expire after 7 days). A paid account can sign it (ad hoc / TestFlight) in `scripts/build-ipa.sh` or CI.
- [ ] **Notifications in the apps.** Web push doesn't reach the web views. Register for FCM / APNs natively, and have the crons (`server/routes/cron.js`) send to those tokens as well as to `push_subscriptions`.
- [ ] **Open binge. links in the app.** Android needs `public/.well-known/assetlinks.json` (with the APK's signing fingerprint) and `autoVerify`. iOS needs Associated Domains (`apple-app-site-association`) and a signed build.