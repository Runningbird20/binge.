# TODO

Ideas for binge., roughly in priority order. Each item names the files to start from.

## Features

- [ ] **Watch party / shared queue.** `profile_shares` already sends titles between profiles in an account; a "watch together" link that syncs play/pause through Supabase Realtime would build on it.
- [ ] **Smarter "Because you watched"** (on hold until binge. has enough users with overlapping ratings). Mix in the existing `collaborative_*_candidates` RPCs ("people who liked X also liked") as a lightly weighted extra source next to TMDB `/recommendations` (which already covers this from TMDB's audience) in `src/utils/personalization.js`.
- [ ] **Reading progress across devices.** `BookReader.js` keeps your place in `localStorage` (`binge:reader-progress`), so it doesn't follow the profile to another device. Save it per profile in Supabase, like `continue_watching.position_seconds`.

## UI and UX

- [ ] **Notification inbox.** New-episode, reminder, game and admin push alerts disappear once dismissed, and nothing in the app lists them. Add a bell in the navbar with the last 30 days of alerts (one table both crons write to), with unread dots.

## Tests and reliability

- [ ] **Unit tests for the rest of the untested utils.** `catalogLookup`, `browseRows`, `playbackPositions`, `releaseCalendar` (`.ics`), `searchMaturity` and `keptCache` have tests now; `newEpisodes` and most of the other utils still don't.

- [ ] **An E2E check for the database split.** Signed in, open Home and assert rows have titles: this would have caught the empty preview (`e2e/`, needs `E2E_EMAIL`/`E2E_PASSWORD`).
- [ ] **E2E for profile PINs** (set PIN → switch away → wrong PIN → right PIN) once a test account exists.

## Mobile

The phone apps exist (`mobile-android/`, `mobile-ios/`; each builds with its own `scripts/build-apk.sh` / `scripts/build-ipa.sh`, and CI builds both in `mobile-apps.yml`). Next:

- [ ] **A signed iPhone app.** Without an Apple Developer account the `.ipa` has to be re-signed with a personal Apple ID (installs expire after 7 days). A paid account can sign it (ad hoc / TestFlight) in `mobile-ios/scripts/build-ipa.sh` or CI.
- [ ] **Notifications in the apps.** Web push doesn't reach the web views. Register for FCM / APNs natively, and have the crons (`server/routes/cron.js`) send to those tokens as well as to `push_subscriptions`.
- [ ] **Open binge. links in the iPhone app.** Android does already (a verified App Link: `autoVerify` in its manifest + `public/.well-known/assetlinks.json`). iOS needs the Associated Domains entitlement (`applinks:binge-26.vercel.app`) and `public/.well-known/apple-app-site-association` with the Team ID, served as `application/json` (a `headers` entry in `vercel.json`, since the file has no extension). A free Apple ID's personal team can't use Associated Domains, so this waits on "A signed iPhone app".