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

## Removing books

Decided 2026-11-18: binge. drops books entirely: browsing, reading, ratings and the catalog table. Movies, series and sports stay.

- [ ] **Decide about Manga & Comics first.** It's a tab on the Books page (`src/components/MangaTab.js`, `src/components/manga/`, `src/utils/mangaProviders.js`, `src/utils/anilist.js`, `server/routes/manga.js`). It either goes with books or moves to a page of its own.
- [ ] **Tell people before their book data goes.** The migration below deletes book ratings and My List rows. Post an announcement (Admin → Announcements) first, so anyone who wants them can use Download my data.
- [ ] **The website.**
  - Delete the Books page and its parts: `src/pages/Books.js`, `src/components/BookBrowseView.js`, `src/components/BookReader.js`, `src/components/books/`, `src/utils/bookAccess.js`, `src/utils/bookRows.js`, `src/utils/adaptations.js`, and their tests.
  - Delete the book ↔ screen links on movies: `src/components/title/SourceBooks.js`.
  - Take out `/books` and `/book/:id` (`src/App.js` and its `PAGE_LOADERS`, `src/components/MediaOverlay.js`), and Books in `src/components/Navbar.js` and the phone's Browse sheet (`src/components/BottomNav.js`).
  - Drop the book branches from shared code:
    - catalog reads: `src/utils/catalogQueries.js`, `src/utils/supabaseApi.js`;
    - search: `searchExtras`, `searchFilters`, `searchMaturity`, `GlobalSearch`, `SearchResults`;
    - ratings: `RatingInput`, `StarRating`, `RatingArtifact`;
    - the dashboards: `libraryStats` ("read" as a status goes too), `wrapped`;
    - also `dataExport`, `watchlistStatus`, Home's Books row, `Landing`, and `src/testUtils/pageTestSetup.js`.
  - Delete `src/utils/recommendations.js`, the older genre-sampling engine. Home's Books row is its last real caller; its other one, `/chat/recommendations` in `supabaseApi.js`, is never requested. It's in the first download today.
  - Book styles in `App.css`, `streaming.css`, `title.css` and `mobile.css`; the app's name and description in `public/manifest.json` ("Movies, series, books & sports"); `e2e/journey/web-journey.spec.js`.
- [ ] **The server.**
  - `server/routes/books.js` and its line in `server/app.js`.
  - `/book/:id` link previews: `server/routes/og.js`, the bot rule in `vercel.json`.
  - Books in search (`server/catalogSearch.js`, `server/catalogRelated.js`), `server/data-access/` and `server/utils/databaseHealth.js`.
  - `GOOGLE_BOOKS_API_KEY` in `.env.example` and on Vercel.
- [ ] **The catalog (Turso).** About 20,000 rows and 37 MB of the 395 MB catalog (the local copy of 2026-11-04).
  - Drop `books`, the `book_genres` view, `books_fts`, `books_text_fts` and their triggers and indexes (`turso/schema.sql`), and the books entries in `catalog_genres` and `catalog_stats`.
  - Update `MEDIA_TABLES` in `src/utils/mediaDatabase.js`, the `MEDIA` list in `scripts/check-database-split.js`, `scripts/turso-catalog.js`, `scripts/catalog-health.js`, and the book cases in `scripts/search-benchmark.js`.
- [ ] **Account data (Supabase).** A migration that deletes every `media_type = 'book'` row, drops `book_ratings`, and narrows the `media_type` checks to movies and series. Record the dropped table the way `20261029120000_record_removed_tables.sql` does, or `check-supabase-migrations.js` will still expect it. Update `supabase/repeatable_schema.sql` to match.
- [ ] **The import scripts.** The Goodreads, Internet Archive and Open Library scrapers in `scripts/scrapers/`, and their `import:goodreads*`, `import:books*` and `import:openlibrary*` entries in `package.json`, and their test, `src/importerFilters.test.js`. That empties `scripts/scrapers/`. The Goodreads scraper is the only user of the `playwright` dependency (E2E uses `@playwright/test`), so that goes too, with the Goodreads settings in `.env.example`.
- [ ] **The TV apps.** They have no books screen. Drop `books`/`book_genres` from the catalog table lists (`tv-apple/BingeTV/Data/Supabase.swift`, `tv-android/app/src/main/java/com/binge/tv/data/Supabase.kt`) and the "Books, manga and account settings are on …" line (`tv-apple/BingeTV/Views/SearchView.swift`, `tv-android/app/src/main/java/com/binge/tv/ui/Me.kt`).
- [ ] **The docs.** In `CLAUDE.md`: Books & manga reading, "Book ids must stay below 2^53", Book ↔ screen, and the books parts of search, the title popup and the data import notes. The Books & manga row in `DIFF.md`, and `docs/database-split.md`.

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
