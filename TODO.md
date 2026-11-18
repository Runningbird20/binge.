# TODO

Ideas for binge., roughly in priority order within each section. Each item names the files to start from. Remove an item when it ships.

## Features

- [ ] **Watch party / shared queue.** `profile_shares` already sends titles between profiles in an account; a "watch together" link that syncs play/pause through Supabase Realtime would build on it.
- [ ] **A month view for the Release Calendar.** `/calendar` is a list. Show the same releases on a month grid, and keep the `.ics` export: `src/pages/ReleaseCalendar.js`, `src/utils/releaseCalendar.js`.
- [ ] **Notification inbox follow-ups.**
  - Opening a push marks its inbox entry read. Send the row's id in the push payload, and have `notificationclick` in `public/sw.js` open the link with it, so the page can call `markNotificationsRead` (`src/utils/notificationsInbox.js`). Bump `CACHE_NAME`.
  - New alerts show up at once through Supabase Realtime on `notifications`, instead of the 5-minute poll in `src/hooks/useNotifications.js`.
- [ ] **Pick for the two of us.** On Home, choose another profile in the account and get titles you'd both like that neither of you has seen. Blend the two profiles' taste (the genre + language profile in `src/utils/personalization.js`) and leave out both profiles' watched titles (`fetchWatchedTitleKeys` in `src/utils/watchedTitles.js`). It fits next to Surprise me (`SurpriseButtons` in `src/pages/Home.js`).
- [ ] **"Where have I seen them?"**
  - On a person page, a first row of what this profile has already seen them in. `fetchPerson` (`src/utils/people.js`) already loads the credits; match them against `useWatchedKeys()`: `src/pages/Person.js`.
  - Then in the title popup's Cast row, a line under each photo ("You saw them in Severance"). That needs each person's credits, so fetch them only for the faces on screen (TMDB `/person/{id}/combined_credits`, cached like the other TMDB calls): `src/components/CastRow.js`.
- [ ] **Spoiler-free episodes.** For episodes past the profile's progress, blur the still and hide the synopsis until it's tapped, as Hide scores does on Sports. A profile setting (`src/utils/profileSettings.js`), applied in `src/components/title/EpisodeList.js` and wherever else an unwatched episode's summary shows.
- [ ] **Catch me up.** A "Story so far" for a series you're coming back to. Groq (already behind Ask binge.) summarizes TMDB's episode overviews up to the last episode this profile watched, and never past it. It grows "Previously on…" (`src/components/title/PreviouslyOn.js`, today the last 3 episode summaries) into a recap of whole seasons. A new route next to Ask binge.'s in `server/routes/extras.js`, cached per show and episode.
- [ ] **"I've got 90 minutes."** A time limit on Surprise me: a movie that fits, or a series whose episodes do. The catalog has no runtimes, so ask TMDB discover with `with_runtime.lte`, or check each candidate with the popup's TMDB details (`src/hooks/useTitleDetails.js`): `src/utils/surprise.js`, `SurpriseButtons` in `src/pages/Home.js`.
- [ ] **Binge planner.** "Finish by Friday": pick a date on a series, and the popup says how many episodes a night that takes, from the episodes left (`src/utils/seasonStatus.js`) and their TMDB runtimes. It can offer a nightly reminder (`watch_reminders`, `src/utils/reminders.js`).
- [ ] **Lists you can share.** Named lists ("Halloween marathon", "Comfort shows") with a link that opens a page of posters, and a preview card when the link is pasted into a chat (`server/routes/og.js` and the bot rule in `vercel.json` already do this for titles).
  - A new Supabase table with a share code and a public read policy. The page has to work signed out, since accounts are invite-only.
  - An older `media_lists` table was dropped (`supabase/migrations/20261029120000_record_removed_tables.sql`). Start fresh rather than bringing it back.
- [ ] **"Worth watching?" for finished games.** A spoiler-free 1–5 rating, worked out from how much the win probability swung and how often the lead changed, so a replay can be picked without seeing the score. It shows on the card and in `LiveScorePanel`, and stays while Hide scores is on, since it gives nothing away. ESPN's game summary (fetched in `src/utils/liveScores.js`) has win probability for some leagues; check which first.
- [ ] **Smarter "Because you watched"** (on hold until binge. has enough users with overlapping ratings). Mix in the existing `collaborative_*_candidates` RPCs ("people who liked X also liked") as a lightly weighted extra source next to TMDB `/recommendations` (which already covers this from TMDB's audience) in `src/utils/personalization.js`.
- [ ] Chang reminder bell to notify you if a new season is announced and when new episodes drop.

## Removing books

Decided 2026-11-18: binge. drops books and Manga & Comics entirely: browsing, reading, ratings and the catalog table. Movies, series and sports stay. The code, the TV apps and the docs are done (2026-11-18); old `/books` and `/book/:id` links redirect to Home. Two steps are left, both on the live databases and both only once this is deployed. Manga kept its list and ratings in each browser's localStorage, so it has no account data to delete.

- [ ] **Drop the books table on Turso, right after this is deployed:** `node scripts/turso-catalog.js drop-books` (tested on a copy of the catalog; safe to run again). Not before: the live site and `main`'s scheduled syncs still read `books` until then. Not much later either: from Monday the weekly database-split check reports the leftover table. Then delete the `drop-books` command. Turso keeps the freed pages (~37 MB) for reuse, so its storage figure may not fall.
- [ ] **Apply the Supabase migration, right after this is deployed:** run `supabase/migrations/20261118120000_remove_books.sql` in the Supabase SQL editor (tested on a local Postgres copy of the schema; safe to run again). It deletes every `media_type = 'book'` row, drops `book_ratings` and `collaborative_book_candidates`, narrows the `media_type` checks to movies and series, and rebuilds `admin_stats()` without books. There's no undo: the book rows are gone for good. Not before deploying: until then the live site still saves book ratings and list rows.

## Streaming servers

From the sandbox retest of 2026-11-16 (the `sandbox` notes in `src/utils/embedServers.js`).

- [ ] **Remove the servers that no longer work.**
  - Videasy: its domain doesn't resolve.
  - VidSrc Classic: no video, sandboxed or not.
  - 2Embed: an adult ad page when sandboxed, and it takes over the whole tab when not.

  Files: `src/utils/embedServers.js` (the uptime probe follows it), `PAUSE_AWARE` in `src/utils/embedProviders.js` (it lists Videasy), the TV apps' server lists, `DIFF.md`.
- [ ] **VidRift sends its player to ad pages** about 13 seconds in, sandboxed or not; a sandbox can't stop a frame navigating itself.
  - Try a `Content-Security-Policy: frame-src` that allows only the embed hosts (`headers` in `vercel.json`), so the player frame can't load an ad page.
  - Or rank VidRift lower (`src/utils/streamPreferences.js`).
- [ ] **VidCore** mostly sits behind fake "install … to unlock" gates, and none of its WebKit loads played. Rank it last or remove it.
- [ ] **`npm run check:sandbox`.** Turn the retest harness into a script in `scripts/`. It loads each server's real embed URL in an iframe on a non-provider origin, sandboxed and not, in Chrome and WebKit, and passes only on 5 seconds of a full-length `<video>` playing. The `sandbox` flags could then be rechecked in one command whenever a server changes.

## Accounts, email and operations

- [ ] **Invites that stay out of spam.** If invites from the live site still land in spam, give the site its own domain and send from it through an email service instead of Gmail: `server/mailer.js`, `SITE_URL`, `docs/invite-only.md`.
- [ ] **Password-reset emails for everyone.** Supabase's built-in sender only reaches the Supabase team's addresses. Set the same SMTP under Authentication → Emails → SMTP Settings (`docs/password-reset.md`).
- [ ] **Alerts before a database fills up.**
  - Run `databaseReport` (`server/utils/databaseHealth.js`) from the daily cron, and push the admins (`notifyAdmins` in `server/routes/cron.js`) when Supabase or Turso passes 80% of its plan.
  - Set `TURSO_PLATFORM_TOKEN` and `TURSO_ORG` to add Turso's monthly reads and writes.
- [ ] **Slow catalog lookups by TMDB id.** Admin → Errors shows lookups with `source_key in` 40–50 values taking over 2 seconds; that's the browse rows' catalog matching. Check the plan with `CATALOG_DEBUG=plan` and the `source_key` index: `src/utils/catalogLookup.js`, `server/data-access/query.js`, `turso/schema.sql`.

## Code cleanup

Checked against the code on 2026-11-18.


## Tests and reliability

- [ ] **Unit tests for the untested utils.** 35 of 90 `src/utils` modules have no test file. Next, logic that changes what users see: `recommendations`, `catalogQueries`, `franchises`, `profileSettings`, `watchlistStatus`, `aiSearch`.
- [ ] **Run the signed-in E2E specs.** Create a dedicated test account and set `E2E_EMAIL`/`E2E_PASSWORD` (`.env`). `e2e/catalog.spec.js` (Home and Movies rows have titles from the catalog) and `e2e/profile-pin.spec.js` (PIN set → wrong PIN refused → right PIN opens; removes the PIN after) have never run signed in, nor have the older signed-in specs here.

## TV apps

- [ ] **The notification inbox on Apple TV and Fire TV.** It's on the website only so far (`DIFF.md`). Read the same `notifications` rows and read marks; `src/utils/notificationsInbox.js` has the query.
- [ ] **Fire TV: hide finished shows in Continue Watching**, as the website (`src/utils/continueWatching.js`) and Apple TV (`finishedShows`) do.

## Mobile

The phone apps exist (`mobile-android/`, `mobile-ios/`; each builds with its own `scripts/build-apk.sh` / `scripts/build-ipa.sh`, and CI builds both in `mobile-apps.yml`). Next:

- [ ] **A signed iPhone app** (on hold). Without an Apple Developer account the `.ipa` has to be re-signed with a personal Apple ID (installs expire after 7 days). A paid account can sign it (ad hoc / TestFlight) in `mobile-ios/scripts/build-ipa.sh` or CI.
- [ ] **Notifications in the apps.** Web push doesn't reach the web views. Register for FCM natively on Android (APNs for the iPhone app is on hold), and have the crons (`server/routes/cron.js`) send to those tokens as well as to `push_subscriptions`.
- [ ] **Open binge. links in the iPhone app** (on hold).
  - Android does already: a verified App Link (`autoVerify` in its manifest + `public/.well-known/assetlinks.json`).
  - iOS needs the Associated Domains entitlement (`applinks:binge-26.vercel.app`) and `public/.well-known/apple-app-site-association` with the Team ID, served as `application/json` (a `headers` entry in `vercel.json`, since the file has no extension).
  - A free Apple ID's personal team can't use Associated Domains, so this waits on "A signed iPhone app".
