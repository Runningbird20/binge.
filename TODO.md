# TODO

Ideas for binge., roughly in priority order within each section. Each item names the files to start from. Remove an item when it ships.

## Features

- [ ] **Watch party / shared queue.** `profile_shares` already sends titles between profiles in an account; a "watch together" link that syncs play/pause through Supabase Realtime would build on it.
- [ ] **Catch me up.** A "Story so far" for a series you're coming back to. Groq (already behind Ask binge.) summarizes TMDB's episode overviews up to the last episode this profile watched, and never past it. It grows "Previously on…" (`src/components/title/PreviouslyOn.js`, today the last 3 episode summaries) into a recap of whole seasons. A new route next to Ask binge.'s in `server/routes/extras.js`, cached per show and episode.
- [ ] **"I've got 90 minutes."** A time limit on Surprise me: a movie that fits, or a series whose episodes do. The catalog has no runtimes, so ask TMDB discover with `with_runtime.lte`, or check each candidate with the popup's TMDB details (`src/hooks/useTitleDetails.js`): `src/utils/surprise.js`, `SurpriseButtons` in `src/pages/Home.js`.
- [ ] **Binge planner.** "Finish by Friday": pick a date on a series, and the popup says how many episodes a night that takes, from the episodes left (`src/utils/seasonStatus.js`) and their TMDB runtimes. It can offer a nightly reminder (`watch_reminders`, `src/utils/reminders.js`).
- [ ] **Lists you can share.** Named lists ("Halloween marathon", "Comfort shows") with a link that opens a page of posters, and a preview card when the link is pasted into a chat (`server/routes/og.js` and the bot rule in `vercel.json` already do this for titles).
  - A new Supabase table with a share code and a public read policy. The page has to work signed out, since accounts are invite-only.
  - An older `media_lists` table was dropped (`supabase/migrations/20261029120000_record_removed_tables.sql`). Start fresh rather than bringing it back.
- [ ] **"Worth watching?" for finished games.** A spoiler-free 1–5 rating, worked out from how much the win probability swung and how often the lead changed, so a replay can be picked without seeing the score. It shows on the card and in `LiveScorePanel`, and stays while Hide scores is on, since it gives nothing away. ESPN's game summary (fetched in `src/utils/liveScores.js`) has win probability for some leagues; check which first.
- [ ] **Smarter "Because you watched"** (on hold until binge. has enough users with overlapping ratings). Mix in the existing `collaborative_*_candidates` RPCs ("people who liked X also liked") as a lightly weighted extra source next to TMDB `/recommendations` (which already covers this from TMDB's audience) in `src/utils/personalization.js`.
- [ ] Change reminder bell to notify you if a new season is announced and when new episodes drop.

## Accounts, email and operations

- [ ] **Invites that stay out of spam.** If invites from the live site still land in spam, give the site its own domain and send from it through an email service instead of Gmail: `server/mailer.js`, `SITE_URL`, `docs/invite-only.md`.
- [ ] **Password-reset emails for everyone.** Supabase's built-in sender only reaches the Supabase team's addresses. Set the same SMTP under Authentication → Emails → SMTP Settings (`docs/password-reset.md`).
- [ ] **Alerts before a database fills up.**
  - Run `databaseReport` (`server/utils/databaseHealth.js`) from the daily cron, and push the admins (`notifyAdmins` in `server/routes/cron.js`) when Supabase or Turso passes 80% of its plan.
  - Set `TURSO_PLATFORM_TOKEN` and `TURSO_ORG` to add Turso's monthly reads and writes.
- [ ] **Slow catalog lookups by TMDB id.** Admin → Errors shows lookups with `source_key in` 40–50 values taking over 2 seconds; that's the browse rows' catalog matching. Check the plan with `CATALOG_DEBUG=plan` and the `source_key` index: `src/utils/catalogLookup.js`, `server/data-access/query.js`, `turso/schema.sql`.

## Code cleanup

## Tests and reliability

- [ ] **Unit tests for the untested utils.** 35 of 90 `src/utils` modules have no test file. Next, logic that changes what users see: `recommendations`, `catalogQueries`, `franchises`, `profileSettings`, `watchlistStatus`, `aiSearch`.
- [ ] **Run the signed-in E2E specs.** Create a dedicated test account and set `E2E_EMAIL`/`E2E_PASSWORD` (`.env`). `e2e/catalog.spec.js` (Home and Movies rows have titles from the catalog) and `e2e/profile-pin.spec.js` (PIN set → wrong PIN refused → right PIN opens; removes the PIN after) have never run signed in, nor have the older signed-in specs here.

## TV apps

## Mobile

The phone apps exist (`mobile-android/`, `mobile-ios/`; each builds with its own `scripts/build-apk.sh` / `scripts/build-ipa.sh`, and CI builds both in `mobile-apps.yml`). Next:

- [ ] **A signed iPhone app** (on hold). Without an Apple Developer account the `.ipa` has to be re-signed with a personal Apple ID (installs expire after 7 days). A paid account can sign it (ad hoc / TestFlight) in `mobile-ios/scripts/build-ipa.sh` or CI.
- [ ] **Notifications in the apps.** Web push doesn't reach the web views. Register for FCM natively on Android (APNs for the iPhone app is on hold), and have the crons (`server/routes/cron.js`) send to those tokens as well as to `push_subscriptions`.
- [ ] **Open binge. links in the iPhone app** (on hold).
  - Android does already: a verified App Link (`autoVerify` in its manifest + `public/.well-known/assetlinks.json`).
  - iOS needs the Associated Domains entitlement (`applinks:binge-26.vercel.app`) and `public/.well-known/apple-app-site-association` with the Team ID, served as `application/json` (a `headers` entry in `vercel.json`, since the file has no extension).
  - A free Apple ID's personal team can't use Associated Domains, so this waits on "A signed iPhone app".
