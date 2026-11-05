# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**binge.** — watch, track and rate movies, series and books, plus live sports. Three apps share one account system:
- **The website** (`src/`, React 19 + React Router 7, Create React App). It's used on computers, on phones (bottom-nav layout, installable as a PWA) and in smart-TV browsers (TV mode).
- **The Apple TV app** (`tv-apple/`, SwiftUI).
- **The Fire TV / Android TV app** (`tv-android/`, Kotlin + Compose for TV).

Video plays from third-party embed servers: cross-origin iframes on the web, driven through an injected bridge script on the TVs. Browse rows are live TMDB lists matched back to our catalog. Personal picks come from a local taste-matching algorithm.

Data lives in two databases: Turso holds the media catalog, Supabase holds accounts and user data (Postgres + Auth + RLS). A secondary Express backend runs as Vercel serverless functions. It serves:
- the catalog proxy;
- everything that needs a server-side key: service-role admin calls, OMDb, Groq, OpenSubtitles, push;
- the cron jobs;
- the sports and books proxies.

`DIFF.md` tracks which features exist on which app.

## Commands

```bash
npm start                 # runs client (CRA dev server) + Express server concurrently
npm run start:client      # CRA dev server only (port 3000, proxies /api to :5001 — see "proxy" in package.json)
npm run server            # Express server only (server/index.js, port 5001)
npm run build             # production build (react-scripts build) — CI=true build treats warnings as errors
npm test                  # Jest/RTL in watch mode
CI=true npx react-scripts test --watchAll=false                    # run the full suite once, non-interactive
CI=true npx react-scripts test --watchAll=false src/pages/Books.test.js    # run a single test file
node --test server/data-access/*.test.js server/routes/*.test.js    # server tests (CI runs these too)
npm run test:e2e          # Playwright, local only (see Testing notes)
```

There is no separate lint script. ESLint runs as part of `react-scripts build`/`test` via the `react-app` config in `package.json`. A `CI=true` build fails on any ESLint warning (unused vars, missing hook deps). Always do a `CI=true` build after removing code, not just a normal one.

**Keeping local code current.** Twice the Movies/TV pages came up empty because the local code was the Neon-era version: once from an API server started before a `git pull`, once from a branch cut from a stale local `main`. That database no longer accepts logins. Three guards now:
- **`npm run server` runs `node --watch`**, so a pull or branch switch restarts it with the new code.
- **`npm start` first runs `scripts/check-branch.js`** (`prestart`).
  - A branch with no commits of its own that's behind `origin/main` (`main` itself, or a branch just cut from an old `main`) is fast-forwarded, and local `main` moves along.
  - A branch with its own commits gets a note to `git merge origin/main`.
  - It's fast-forward only, never stops the start, and does nothing offline. `BINGE_NO_AUTO_UPDATE=1` turns it off.
- **The API server says at start which catalog it reached** (`Catalog: Turso (host), 23 tables`), or why it couldn't (missing or wrong `TURSO_*` in `.env.local`).

Branch from an up-to-date `main` (`git pull` on `main` first, or `git switch -c name origin/main`). A git hook doing this automatically was considered and dropped: installing hooks from `npm install` was judged too invasive.

### Data import / seeding scripts

The repo also owns the pipeline that fills the catalog tables (movies/tv_shows/books, **in Turso**) from external sources. These are standalone Node scripts, not part of the app runtime, and you only touch them when the task is about catalog data, not app features.
- **Older importers:** the `npm run` entries prefixed `import:*` and `supabase:*` in `package.json`. The Goodreads, TMDB, Plex, Internet Archive and Open Library scrapers/importers are in `scripts/scrapers/` and write to the root `data/` folder. `scripts/run-supabase-sql.js` applies `supabase/repeatable_schema.sql` + seed files.
- **Bulk sync:** `scripts/sync-tmdb-to-turso.js` (`sync-tmdb.yml`; shared TMDB helpers in `scripts/tmdb-records.js`). It works through TMDB's export by popularity, so it misses small new regional releases.
- **Language sync:** `scripts/sync-language-to-turso.js` fills that gap.
  - `npm run import:language`, default `LANGUAGES=ml`. `:preview` is a TMDB-only dry run.
  - Runs monthly on the 1st (`sync-languages.yml`, `LANGUAGES=ml`).
  - Adds every title in the language from the last 3 years + 30 days ahead, plus the all-time popular ones, and re-fetches anything released in the last 120 days.

## Repo layout

- `src/` — the website: `pages/`, `components/` (player hooks in `components/player/`), `hooks/`, `contexts/`, `utils/` (data access in `utils/data/`), stylesheets in `styles/` (imported once from `App.js`/`index.js`; nearly everything new goes in `styles/streaming.css`).
- `server/` + `api/` — the Express backend and its Vercel function entry points.
- `scripts/` — catalog sync, checks and one-off migrations; `scripts/scrapers/` — the older import scrapers (output in `data/`).
- `supabase/` — accounts/user-data schema (`migrations/`, `repeatable_schema.sql`, `manual/`); `turso/schema.sql` — the media catalog schema.
- `tv-apple/`, `tv-android/` — the TV apps; `e2e/` — Playwright; `backups/`, `data/` — local-only (gitignored): catalog exports and scraper output/checkpoints.
- `docs/` — longer write-ups: `database-split.md` (the split and its measured costs), `profile-locks.md`, `password-reset.md`, and the TV app notes `tv-apps.md`, `apple-tv.md`, `fire-tv.md`.
- `DIFF.md` — which features exist on the website (computer / phone), Apple TV and Fire TV but not the others. **Update it whenever a feature ships on only some of them** (and delete a row once every app has it).
- `TODO.md` — the feature backlog, each item naming the files to start from. Remove an item when it ships.

## Data & backend

### Two databases: Turso = media catalog, Supabase = accounts + user data

Nothing lives in both (see `docs/database-split.md`). The `supabase` client exported by `src/utils/supabase.js` is split:
- These go to the catalog through `/api/neon-data`: `.from()` on movies/tv_shows/books, the genre views, title_ratings, episode_ratings_cache and subtitle_cache, plus `rpc('search_catalog')`. The route is read-only and media tables only; it kept its Neon-era name because installed TV builds call it.
- Everything else is real Supabase.

Server code uses the same split (`server/data-access/client.js`); the TV apps send media `GET`s to `{site}/api/neon-data/rest/{table}`. Never join user tables to media in SQL (they're in different databases): fetch ids, then look titles up. `.github/workflows/database-split.yml` checks weekly that nothing has drifted back.

**Turso (moved from Neon 2026-11-04).** libSQL/SQLite (`server/catalogDb.js`): `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`, or `file:data/turso/catalog.db` for a local copy made with `turso-catalog.js pull --db file:…`. Schema in `turso/schema.sql`; maintenance with `scripts/turso-catalog.js` (`schema`, `refresh`, `rebuild-search`, `pull`). Nothing reads or syncs with Neon any more.
- **SQL dialect.** `server/data-access/query.js` turns the PostgREST-shaped specs into SQLite SQL: `?N` params, `LIKE` for ilike, Postgres's NULL ordering spelled out, titles `COLLATE NOCASE`, no `DEFAULT` in VALUES. `catalogDb.query` also accepts the routes' Postgres-flavoured SQL (`$1`, `ILIKE`), but `ANY()`, `::casts` and `NOW()` don't exist. Turso also rejects named arguments a statement doesn't use (local SQLite ignores them).
- **Turso bills rows scanned** (free plan: 500M reads / 10M writes a month), so every query needs an index.
  - Run the server with `CATALOG_DEBUG=plan` to log each query plan. `FULL SCAN` means one read per row.
  - Write `IS NOT NULL` (the translator does this for `not.is.null`). SQLite only uses the partial `WHERE poster_url IS NOT NULL` indexes for that literal form.
  - Never page with a deep random `OFFSET`: it reads every skipped row. Random windows use `fetchRandomIdWindow` (the rows after a random id).
  - The HTTP API reports `rows_read` per statement (`POST {url}/v2/pipeline`). That's how the costs in `docs/database-split.md` were measured.
- **Stored aggregates.** Genre lists (`catalog_genres`, behind the `*_genres` views) and row counts (`catalog_stats`) are stored, and `turso-catalog.js refresh` rebuilds them after each sync. `count: 'planned'` reads the stored count. An exact filtered count is computed once, stored in `catalog_stats` (`count:<hash>`) and cleared by `refresh`.
- **Search columns.** Rows written to movies/tv_shows/books must carry the `search_*` columns (`withSearchColumns`; the trusted `executeQuery` path adds them for you). They're never returned to clients.

### Supabase-first, Express as a privileged fallback

This is the one thing every route/feature decision hinges on. There are two ways data gets to the frontend:

1. **Direct Supabase calls** (the default path). Most of the app calls functions in `src/utils/supabaseData.js` directly. It re-exports `src/utils/data/{account,library,progress,shared}.js`; tests `jest.spyOn` it, so keep its exports plain `export const`. These use the Supabase JS client (`src/utils/supabase.js`, anon/publishable key) straight from the browser, protected by Row Level Security policies (see `supabase/repeatable_schema.sql`).
2. **The `api` object** (`src/api.js`). A smaller set of routes go through `api.get/post/put/patch/delete(path, body)`. This first tries `executeSupabaseRoute()` (`src/utils/supabaseApi.js`), a client-side router that reimplements a handful of REST-shaped endpoints (search, media details, profile, admin) as direct Supabase queries. If that returns `null` for a path, it falls through to `requestLegacyApi()`, which hits the real Express backend at `/api/...`. `api.js` retries GETs, and the Ask binge. POST, once on a network failure.

**The Express backend** (`server/app.js` + `server/routes/*.js`) is deployed unconditionally as a Vercel serverless function (`api/index.js` re-exports `server/app`; `vercel.json` routes `/api/(.*)` to `api/[...slug].js`). Its route files:
- `neonData` — the catalog proxy;
- `extras` — OMDb ratings, episode ratings, Ask binge., subtitles;
- `sports` — feeds, ESPN, fantasy;
- `books`, `manga` — reading proxies;
- `cron`, `ops` — error reports, health checks, broadcasts;
- `admin`, `account` — service role;
- `notifications` (an in-app list with read state), plus the older REST routes the `api` fallback reaches.

Whether the **frontend** may fall through to Express is gated by `REACT_APP_ENABLE_LEGACY_BACKEND`, or `REACT_APP_LEGACY_API_URL` for a separately hosted backend (see `src/api.js`). Production (`vercel.json`) sets it to `true`.

**When you add or change a route, decide deliberately which path it belongs on:**
- If it only needs the anon key + RLS, implement it as a plain function in `supabaseData.js` (called directly) or as a branch in `supabaseApi.js`'s `executeSupabaseRoute` (called via `api.*`).
- If it needs the Supabase **service-role key** (anything under `supabase.auth.admin.*`: creating/deleting auth users, reading `last_sign_in_at`, etc.), it can *only* live in the Express backend (`server/routes/*.js`), because the service-role key must never reach the browser. Make the matching branch in `supabaseApi.js` return `null` so `api.js` falls through to it (see the `/admin/users*` handling for the pattern).

### CORS

`server/app.js` always allows the request's own origin. The site and API share one origin on Vercel, but browsers send `Origin` on POSTs. It also allows `CLIENT_URL` (comma-separated), Vercel deployment URLs and localhost. Disallowed origins just get no CORS headers (no 500).

### Accounts, profiles & settings

**Auth.** Supabase Auth (email/password) is the identity system.
- A Postgres trigger, `handle_auth_user_changed` (`supabase/repeatable_schema.sql`), fires on insert/update to `auth.users`. It creates or updates the matching `public.profiles` row from `raw_user_meta_data` (username, bio, `is_admin`, `is_dev`).
- Every user-owned table has its `user_id` FK to `auth.users(id)` declared `on delete cascade`. Deleting the `auth.users` row (the service-role `auth.admin.deleteUser` call) cascade-deletes the user's profile, ratings, watchlist and so on; no separate "delete profile" step is needed.
- **Deleting an account.** Users delete their own account from Account Settings: `deleteAccount(password)` in `AuthContext` → `POST /api/account/delete` (`server/routes/account.js`, service role). The route:
  1. checks the password by signing in with it (5 wrong tries per 15 min per account);
  2. refuses to delete the only admin;
  3. calls `auth.admin.deleteUser`;
  4. removes the user's files in the `avatars` bucket (Storage isn't covered by the cascade).
- **Password reset.** `/forgot-password` → email → `/reset-password` (`docs/password-reset.md`; the redirect URLs must be listed in Supabase).
- `src/contexts/AuthContext.js` wraps Supabase auth-state changes. It exposes `user` (with `isAdmin`/`isDev` resolved via `src/utils/userAccess.js`), `signIn`, `signUp`, `logout`, etc.
- `src/components/ProtectedRoute.js` gates routes, and `allowedUserTypes` restricts them by role (see `/admin` in `src/App.js`).

**Profiles** (`account_profiles`; picker at `/profiles`, editing at `/profiles/:profileId/edit`):
- **PIN locks.** Set with the `set_profile_lock` RPC and checked with `verify_profile_pin` / `list_profile_locks` (`ProfileSecurityDialog.js`, `utils/profileLocks.js`; `docs/profile-locks.md`).
  - PINs are bcrypt-hashed. Five wrong tries start a 5-minute cooldown.
  - Saving a lock asks for the account password.
  - It's a selection lock inside one account, not a security boundary.
  - **Never select `pin` into the client profile list.**
- **Profile scoping.** Reads go through `scopeToProfile` in `src/utils/data/shared.js`. The default profile (or an account's only profile) also owns rows with `profile_id` null, the same rule as the TV apps. Before this, those titles showed on the TV but never on the website.
- **Maturity levels** (`src/utils/kidsMode.js`):
  - The levels are Toddler (G/TV-Y), Kids, Teens (+PG-13/TV-14) and No restrictions, picked with pills on Edit Profile.
  - `is_kids` stays the master switch; `account_profiles.settings.maturity` picks the level (Kids when missing).
  - Catalog filters take `kidsSafe` = `false` or the level (`maturityRestriction(profile)`, `ratingsFor`).
  - Only Toddler/Kids get the kids-only rows (`isChildLevel`).
  - The website lets unrated Family/Animation/Kids titles through. The TV apps leave out every unrated title on a restricted level (see TV apps).
  - **Every TMDB list goes through `resolveTmdbItems(…, { kidsSafe })`.** That covers browse rows, More Like This, search's "More like {title}", franchise lists, a book's screen adaptations, the calendar's Coming Soon row and person pages. A new call that shows titles must pass the level too; leaving it out shows everything.
  - **Website search results don't apply maturity levels yet:** title matches, Ask binge. picks and person search.
- **Profile settings** (`/settings`, `src/utils/profileSettings.js`):
  - Autoplay next, previews, data saver, haptics and captions-first live in `account_profiles.settings` (jsonb) + localStorage.
  - Audio/subtitle prefs live in `audio_pref`/`subtitle_pref`.
  - `AuthContext` hydrates both from the profile row on load. The row wins, because it's written on every change.

### Admin, monitoring & ops

- **Admin panel** (`/admin`, `src/pages/AdminHome.js` + `src/pages/admin/*`). Its tabs:
  - **Overview** — the `admin_stats()` RPC (aggregates only; refuses non-admins).
  - **Servers** — status, Check now (`POST /api/ops/health-check`), and a per-server on/off switch in `server_config` that the player honors via `fetchDisabledServers`.
  - **Sports feeds** (`AdminSportsServers.js`, under Servers) — keys `sports:ppv` / `sports:streamfree` / `sports:streamed` / `sports:streamed:<source>`. Disabled feeds are dropped before merging by `withoutDisabledFeeds` in `fetchSportsStreams`, and by `switchKeys` on the TVs.
  - **Errors.**
  - **Announcements** — `site_announcements` → `AnnouncementBanner` on every page.
  - **Notifications** — `POST /api/ops/broadcast`, a push to every device.
  - **Users** (`AdminUsersPanel.js`) — search/filter, create, promote and delete through the service-role `/api/admin/users*` routes. The old `/admin/users` page is gone; that path redirects to `/admin?tab=users`.

  Admin-only server actions use `adminOnly()` from `server/middleware/supabaseAdmin.js`. Admin-only tables use the `public.is_admin()` RLS helper.
- **Error tracking** (our own, no third party). `src/utils/monitoring.js` posts ErrorBoundary crashes and uncaught errors/rejections (production only, noise-filtered, 1/min per error) to `POST /api/ops/errors` (`server/routes/ops.js`, rate-limited), which writes `error_events`. The Express error handler logs 5xx errors there too. Admins read and resolve them in the panel.
- **Server uptime** (`checkServers` in `server/routes/cron.js`, table `server_status`):
  - Probes each embed server with TMDB id 550 every 15 min, from the reminders job (or `/api/cron/health`), and merges the last 24h of viewer reports.
  - A 401/403/429 counts as "unknown" (bot protection), not down.
  - Two consecutive failures send an admin push, plus `ALERT_WEBHOOK_URL` if set.
  - Shown on `/admin` and fed into the player's ranking ("Down right now").
  - Keep `PROBES` in sync with `PROVIDERS` in `src/utils/embedProviders.js`.
- **Server health for ranking.** The `stream_provider_health()` RPC (counts only, security definer) feeds `rankServers`'s `health`. A provider that's broadly down today (`summarizeHealth`) ranks last and is labelled; title-specific reports still win.

### Book ids must stay below 2^53

Book ids were SHA-1-derived 60-bit numbers, which JavaScript silently rounds, so opening or saving a book hit the wrong id. The seed generator that made them (since removed; see git history) switched to 52-bit ids, and `supabase/migrations/20261007140000_book_ids_js_safe.sql` remaps existing rows (`id >> 8`). Any new id scheme must stay within `Number.MAX_SAFE_INTEGER`.

## Website

### Routing, loading & errors

- `src/App.js` is the single route table. Pages are lazy-loaded with `lazyWithReload` (`utils/lazyWithReload.js`): `React.lazy`, plus one reload (at most once a minute) when a deploy has removed the old build's chunks. Page code is prefetched on idle after load (`PAGE_LOADERS`), so switching pages doesn't wait on a download. A new page needs both entries.
- Routes needing auth are wrapped in `<ProtectedRoute>`. Admin-only routes also pass `allowedUserTypes={['admin']}`.
- **Loading** shows `LoadingBar` (`components/LoadingBar.js`) in the box the content will fill: rows, grids and cards (`SkeletonCard`/`SkeletonGrid` render it too). It has a label and a bar that counts finished data requests (`trackedFetch` in `utils/loadingProgress.js`). Never use a page-centered spinner. The person page uses `.person-skel` placeholders.
- **Errors/offline:** an `ErrorBoundary` per route (`AppShell`), per `TitleRow` (`RowProblem` + Retry) and around `BrowseHero`; plus `OfflineBanner`.

### One responsive layout, two player layouts

- Cards and title/book popups are single responsive components (`TitleCard`, `MediaDetailsModal`, `BookDetailsModal`). The old `MediaCard`/`MobileMediaCard`, `MobileMediaDetail` and `MobileBookDetail` forks are gone.
- **The player is the one split.** `EmbedPlayer.js` renders `components/player/MobilePlayer.js` or `DesktopPlayer.js`, chosen by `useDeviceType().isMobile` (`src/hooks/useDeviceType.js`). A phone is a screen whose short side is ≤ 768 px: a landscape phone counts, a tablet doesn't, and TV mode never does. When you change a player control, change both layouts; they don't share markup.
- **Phones:**
  - The bottom nav is Home · Sports · Browse · Search · Me. Browse and Me open `BottomSheet`s, and `html.has-bottom-nav` hides the top search/profile.
  - Title/book sheets close with a swipe down (`hooks/useSwipeDismiss`) and have a sticky Play bar.
  - The player's server/audio/subtitle pickers are bottom sheets (`MobilePlaybackPickers`).
  - Fullscreen + landscape lock only works on Android; iPhones get a "turn your phone" hint.
- **Mini-player:**
  - On computers it's a draggable corner PiP (`MiniPlayerWidget`); on phones, a dock.
  - Both keep saving positions from the embed's messages (`utils/playbackMessages.js`).
  - `MiniPlayerProvider` must sit inside `BrowserRouter`, because Expand navigates.
- **Keyboard** (`components/KeyboardShortcuts.js`, mounted in `AppShell`): spatial arrow-key focus over `.st-card, .st-game, …` (scoped to the open dialog), `/` for search, `?` for help. It stands down while an element with `data-embed-player` is mounted (the player owns the arrows).
- **Mouse-only rule:** every horizontal scroller must have real ‹ › buttons, not just swipe/trackpad scrolling. That means `TitleRow`, `BrowseHero`, `GenreScrollBar`, `CastRow`, and `HScroll` for anything new.
- **PWA:**
  - Manifest `shortcuts`: Continue Watching (`/home?jump=continue`), Sports, Search.
  - `share_target` → `/share` (`pages/ShareTarget.js`): binge./TMDB/IMDb links open the title; anything else searches.
- **Website TV mode** (for smart-TV browsers; the TV apps don't use it):
  - `src/utils/tvMode.js` turns on `html.tv-mode` for `BingeTV` in the UA, TV browser UAs, or `?tv=1` (`?tv=0` turns it off; remembered per device).
  - `useDeviceType` reports desktop in TV mode. A 1080p TV WebView is 960×540 CSS px and would otherwise get the phone layout.
  - In TV mode `KeyboardShortcuts` navigates *every* focusable control, not just cards. It scopes to the open player/sheet and skips hover-only UI (`.profile-hover-drawer`). It lets the player iframe take focus, so the provider gets the remote's keys, and auto-focuses the first control after navigation.
  - It also exposes `window.bingeTvBack()`: out of the video → close the top layer → history back → `false` (leave the app).
  - Title sheets focus Play on open; the player focuses its iframe on load.

### Browse rows, recommendations & release window

Movies/TV land on a Netflix-style rows view (`src/components/BrowseView.js`: a `BrowseHero` spotlight plus `TitleRow`s of `TitleCard`s). `?view=all` or `?genre=` switches those pages to the older filterable grid (`CatalogView` inside `Movies.js`/`TVShows.js`). Home uses the same components.

- **Rows come from live TMDB lists, matched back to catalog rows.** The catalog's own `popularity`/`vote_average` are a stale import snapshot, null for many big titles.
  - `src/utils/browseRows.js` defines each row as a TMDB query (`src/utils/tmdb.js`: browser-side, public `REACT_APP_TMDB_API_KEY`, 30-min sessionStorage cache keyed by path + params) plus a catalog-table fallback (`fetchCatalogBrowseRow`).
  - `src/utils/catalogLookup.js` maps TMDB ids to catalog rows via `source_key = 'tmdb:{movie|tv}:{id}'` (unique index), dedupes, and applies the release window and maturity filtering. Coverage measured ~95–100%.
  - **Hidden Gems** rows use TMDB discover with a high average and a capped vote count, feature-length only.
- **Personalization** (`src/utils/personalization.js`):
  - **History** is ratings (signed, so low ratings push similar titles down) + Continue Watching + episodes watched + watchlist, recency-weighted (0.9^rank, floor 0.25).
  - **Seeds.** The strongest recent positives become "Because you watched X" seeds, which pull TMDB `/recommendations` for that exact title. `pickBecauseRows` picks seeds of different language + genre and rotates daily.
  - **Taste profile.** A genre + original-language profile (language taste is a 0–1 share of history) scores candidates and orders the taste rows (`orderRowsForTaste`). `diversify` caps a run from one language or seed.
  - **Exclusions.** Titles already watched, rated, saved or hidden (`recommendation_hidden`) are left out.
  - `src/utils/recommendations.js` is the older genre-sampling engine, still used for books and the chat route.
- **Seasonal row** (`src/utils/seasonal.js`, TV `Data/Seasonal.swift` / `data/Seasonal.kt`; the same calendar in all three). It's one row, second on the Movies and TV pages (and on the TV apps' Movies/Series tabs), and its title and TMDB query follow the date:
  - **The calendar:** Spooky Season → Halloween Week → Thanksgiving → Christmas → New Year → Snowed In → Valentine's → Black History Month → March Madness → spring/Easter/May the 4th/Mother's Day → summer/Pride/Father's Day/Fourth of July/Shark Week → Back to School → Cozy Fall Mysteries.
  - **Priority.** Seasons are in priority order (short holidays first). One without a query for a type gives way to the next, and every day has a row for both types (tested).
  - **Kids profiles** use each season's `kids` keywords with the kids genre/certification filters.
  - **Sorting.** The row is re-sorted by the profile's taste (`sortForTaste` / `Seasonal.sorted`): top genres + language share, popularity breaks ties. The scoring is the same on all three.
  - Keyword ids are TMDB's; re-check coverage if you change one.
- **Release window** (`src/utils/releaseWindow.js`): released → shown; releasing within 30 days → shown with a "Coming Soon" badge; later → hidden. Apply it to any new browse surface.
- **Watched titles are never recommended** (`src/utils/watchedTitles.js`). Watched means rated, marked Watched/Watching, in Continue Watching, or any episode watched.
  - **Where they're left out:** every row and the spotlight on Movies/TV (`BrowseView`); Home's spotlight, Top Picks, Because you watched, Top 10, taste rows and New Movies; More Like This; search's "More like {title}"; Surprise me.
  - **Where they still show:** search results (title matches, synopsis matches, Ask binge. picks), the `?view=all` grid, person pages, franchises, the calendar, and the profile's own rows (Continue Watching, My List, New Episodes, Sent to you).
  - **How to filter.** Give a recommendation row `hideWatched` (`TitleRow`; it shows its loading bar until the list is known). Put a Top 10's cut in `limit`, not `.slice()`, so it's applied after watched titles drop out. Elsewhere, use `useWatchedKeys()` + `withoutWatched()`.
  - **Data and freshness.** The list is one shared copy per profile (`fetchWatchedTitleKeys`: ids only, paged past the 1000-row cap), reused for a minute. Library and episode writes announce `binge:historyChanged` (the `announcing` wrapper in `supabaseData.js`), so marking something watched takes it out of rows already on screen. Playback's 30-second progress saves don't announce.
- **Spotlight** (`BrowseHero`):
  - **Logo headline.** The headline is the title's logo art (`fetchTitleLogo`, using the popup's own cached TMDB request, for the slide on screen and the next one). The text title shows if there's no logo or it takes over 0.9s.
  - **States and motion.** `items={null}` means loading (a placeholder, no empty-headline flash). It rotates every 35s, even during trailers, and swipes on phones.
  - **Home's spotlight** mixes picks with trending titles on every visit.
- **Trailers** (`src/utils/trailers.js`): hover previews (`HoverPreview.js`: 900ms hover, fine pointers only, no reduced-motion/saveData) and the spotlight billboard use muted YouTube embeds with `pointer-events: none`. They're revealed only after the YouTube JS API reports "playing" + ~2s (`whenTrailerPlaying`); otherwise YouTube's start-up chrome shows.

### Home

- **Continue Watching:**
  - **Season notes.** "2 episodes left in Season 3", "Season 4 starts Friday" (`utils/seasonStatus.js` / TV `Data/SeasonStatus.swift`, same rules).
  - **Finished shows are hidden** (here and on the spotlight's resume slide), using the same TMDB details. A show is finished when its newest aired episode (`last_episode_to_air`) is marked watched in `episode_progress` (`fetchWatchedAmong`) and no position is saved where the row points (`hasSavedPosition`, `utils/continueWatching.js`). New Episodes and the calendar still get the full list, so a new episode brings the show back. The TV apps don't apply this rule yet.
  - **Links carry `&t=`.** Continue Watching links include the saved second (see the web player).
- **New Episodes** row (`src/utils/newEpisodes.js`, TMDB `last_episode_to_air`).
- **Surprise me** (above Continue Watching, `SurpriseButtons` in `Home.js`, logic in `utils/surprise.js`):
  - "Surprise me with a movie" and "… with a series" each open one title of that type.
  - The title comes from the profile's Top Picks / "Because you watched" rows, which `buildPersonalizedRows` has already filtered for maturity and the release window. Picks lean toward the top and skip Coming Soon titles, watched titles (`exclude`) and the last 6 surprises.
  - A profile with no history gets the spotlight's trending titles of that type. A type with nothing to offer loses its button.
  - Styled like the title popup's Trailer button (`st-btn td-resume-control td-play--compact`).
- **Sent to you** — the household queue (`profile_shares`; RLS requires both profiles to belong to the account). Sent with `SendToProfileButton` on the title popup (`utils/profileShares.js`); the TV apps have "Send to…" and the same row.

### Title popup (movies, series, books)

`MediaDetailsModal.js` (movies/TV) and `BookDetailsModal` in `Books.js` share the `td-*` classes in `src/styles/streaming.css`.
- **Layout.** `td-body` is a grid of the main column and `td-aside`.
  - **Main column:** the description, then the full-width **Cast row**. On phones the Cast row comes straight after the description.
  - **`td-aside`:** the facts list (studio etc.), then **Rating & Review** for movies and books (`td-rate--aside`).
  - **Series** keep Rating & Review after the episode list.
  - **Wide TV:** the `td-split--tv` grid uses `display: contents`, so when you move a section, update its grid-row rules too.
  - Both popups close with `td-close td-round-btn`.
- **TMDB details** come from `src/hooks/useTitleDetails.js`: backdrop, logo art, cast, certification, trailer, seasons/episodes and watch providers in one `append_to_response` request. The TMDB id comes from `tmdbIdOf` (`source_key`/`tmdb_id` first), because `getEmbeddedId` prefers the IMDb id most movie rows also carry.
- **Where to watch** (`WhereToWatch`, under the info row): the legal services for the viewer's country, from TMDB `watch/providers`. That's JustWatch data, credited only in the row's tooltip, by decision.
  - Streaming services come first; rent/buy only shows if nothing streams.
  - There's one logo per service. `providerFamily` folds tiers, ad plans and Amazon/Apple/Roku channels, and everything YouTube (TV, Free, Premium) into plain YouTube. Amazon MX Player is hidden.
  - When a title lists only a variant, the plain service's logo is fetched from TMDB's movie + TV provider lists. Paramount+ has no plain TMDB entry in the US, so its mark comes from `utils/brandMarks.js`.
  - See *Where-to-watch logos* below for how the logos are drawn.
- **Cast row** (`CastRow`, heading "Cast"): director/creators first, then the cast, with ‹ › to scroll. Each photo links to `/person/:id` (see People). It replaced the Cast/Director lines in the facts list.
- **Episodes** (`EpisodeList`):
  - **Marking by hand** (logic in `utils/episodeMarking.js`).
    - **Controls.** "Mark season watched" sits left of the season picker and toggles off when the season is done. A check per episode means "Watched up to here" (earlier seasons too); on a watched episode it unmarks just that one.
    - **Writes.** Batch writes are `markEpisodesWatched` / `unmarkEpisodesWatched` in `utils/data/progress.js`. Hand-marked rows have `watched_at` null (watched elsewhere, time unknown), so History (`fetchEpisodeHistory` skips them) and Wrapped only count what was played here. The upsert ignores rows that already exist, so real watch times are never overwritten.
    - **Resume point.** When marking catches you up past the resume point, Continue Watching + the library row move to the next aired episode.
    - **Undo.** Every change shows a note with Undo, which restores the resume point and the original watch times.
    - **Timing.** Marking waits for the episode progress to load (`progressLoaded`).
  - **Previously on…** — Resume on a show after ≥14 days away first shows the last 3 TMDB episode summaries.
  - **Episode heatmap** (`EpisodeHeatmap`): all seasons via one TMDB call per 20 seasons (`append_to_response=season/N`), plus IMDb episode ratings via `/api/extras/episodes` (cached in `episode_ratings_cache`) when OMDb is configured.
- **Franchise order** (`utils/franchises.js`, `FranchiseOrder`):
  - **Ordering.** Curated MCU / Star Wars / Fast & Furious lists offer release and story order (ids verified against TMDB). MCU films sit in separate TMDB sub-collections, so the curated list wins. Any other movie uses its TMDB collection in release order. The toggle is `SlidingTabs` `st-tabs--sm`.
  - **Restricted profiles** only see the franchise's movies within their level, numbered among themselves. Movies over the level aren't listed, not even as "not on binge.", and the section hides when fewer than two are left.
  - **"Mark all watched"** sits left of the toggle, in the same pill as "Mark season watched". It marks every released movie of the franchise that's on binge. and not yet watched or rated.
    - `markMoviesWatched` (`utils/data/library.js`) sets library status `watched`, adding rows as needed, like picking Watched on each one. It returns what `undoMarkMoviesWatched` needs.
    - The popup reloads its own library row through `onLibraryChange`.
    - Unlike hand-marked episodes, these count in Wrapped for the year they're marked (library rows always carry dates).
- **Outside ratings** (`server/routes/extras.js` `/api/extras/ratings`, `src/utils/outsideRatings.js`, `OutsideRatings`):
  - OMDb (IMDb/RT/Metacritic) is looked up server-side and cached in `title_ratings` (shared; public read).
  - Cards only read that cache, in batches (`useCachedImdb`). Never spend OMDb quota per card.
  - Needs `OMDB_API_KEY`; falls back to the TMDB score.
- **Book ↔ screen** (`src/utils/adaptations.js`):
  - Adaptations are identified by TMDB keyword 818 or a crew job of "Novel"/"Book", and matched to catalog books **by author** (titles only rank).
  - Books find their adaptations via a TMDB search verified by the credited author.
- **Remind me** (`RemindButton`) and **Send to profile** (`SendToProfileButton`) sit with the actions.
- Image sizing goes through `src/utils/imageQuality.js` (TMDB srcsets, full-size Goodreads/Open Library covers).

### Where-to-watch logos

The logos are TMDB's app tiles with the tile removed in a canvas (`utils/providerLogos.js`, checked by eye on ~45 real tiles).
- **The steps:**
  - **Background.** It's blended in from the four edges (a Coons patch), so gradient tiles work.
  - **Rim.** The mark's anti-aliased rim takes the mark's colour, so there's no tile-coloured fringe.
  - **Frame and footer.** The tile's outer border goes, and so does a reseller's footer band ("prime video | CHANNELS", `footerTop`).
  - **Captions.** Small caption text ("Google Play", Fandango's "Stream", "The … Channel") is dropped by `removeCaptions`.
  - **Residue.** `removeResidue` drops glow smudges and isolated specks.
  - **Cut-outs.** Shapes cut out of a solid plate (YouTube's triangle, Cinemax's letters, TBS's badge) are put back by `restoreCutouts`, while letter counters stay see-through.
  - **Colour.** Black/grey parts are drawn light. A coloured mark that's dark as a whole (Roku's purple) is lightened evenly to contrast 3. Per-pixel lightening washed out Netflix's N.
  - **Size.** `displaySize` sizes logos optically: wide wordmarks shorter, narrow marks taller.
- **When removal fails**, the original tile shows. The only one left that way is Netflix's red N on the popup's navy.
- **The service worker must never answer a CORS image request with an opaque cached copy.** It taints the canvas; that's why Netflix once showed its black tile.

### People

`src/utils/people.js`, `pages/Person.js` at `/person/:id`.
- **The page** shows a photo, a life line and a bio, then the person's work on binge. as rows.
- **Data.** `fetchPerson` is one TMDB `/person/{id}?append_to_response=combined_credits` request, matched to the catalog with the profile's maturity level. `titlePeople` builds the popup's Cast row.
- **`workCredits`** decides what counts as someone's work, and it's shared with person search:
  - real scripted roles;
  - series with 3+ episodes;
  - directing means films only (one directed episode isn't their work), and creating means series;
  - most widely known first.

  A credit listed as a TV "Director" isn't a creator credit.

### Search

- **Catalog search** (`server/catalogSearch.js`, a port of Neon's `search_catalog`):
  - **Normalized matching.** Titles/authors are compared normalized (`searchNorm`): lowercase, unaccented, punctuation → spaces, Indic marks kept. There's a squashed form for "xmen", and a leading the/a/an is ignored.
  - **Typo pass.** It uses trigram + word similarity, a faithful JS port of pg_trgm, checked against Postgres.
  - **On SQLite.** SQLite has neither, so the normalized text is stored in `search_*` columns at write time. Exact/prefix matches use B-tree indexes; substrings and typo candidates use the trigram FTS5 tables (`*_fts`, kept in step by triggers). Scoring runs in JS with the old formula.
  - **Caching.** Results are cached 10 min per server instance (`server/data-access/client.js`).
  - **Checks.** Run `node scripts/search-benchmark.js` (34/34 found, the same ranks as Neon at the switch). After changing `searchNorm`, run `node scripts/turso-catalog.js rebuild-search`.
- **Search UI** (`src/utils/searchExtras.js`):
  - **Header dropdown.** Top result → Movies → Series → Books → Live games, plus TMDB person search (actors/directors, real roles only, via `workCredits`) and recent searches per profile. A person result links to their page.
  - **`/search` page** (`pages/SearchResults.js`). It has its own input; phones reach it from the bottom nav. The best match leads its own section, and there's no "top result" card. Ask binge.'s per-pick reasons aren't listed under its row.
- **Search filters** (on the results page only, not the header dropdown or the browse pages):
  - Type / decade / language chips (`utils/searchFilters.js`), using `GenreScrollBar` + `genre-chip`, kept in the URL as `?type=&decade=&lang=`.
  - They narrow every section, Ask binge.'s picks included.
  - Each chip list only shows when the results differ on it, and a decade or language filter drops titles whose year or language isn't known.
  - Live games hide while a filter is set.
  - Language names fall back to `Intl.DisplayNames` (`languageName` in `tmdb.js`).
- **Ask binge.** (`utils/aiSearch.js`, `/api/extras/ai/picks`):
  - **Pipeline.** Groq `openai/gpt-oss-120b` (JSON mode) suggests titles. The server verifies each on TMDB (dropping hallucinations, enforcing runtime), and the client keeps only catalog matches, with reasons.
  - **When it runs.** Every search of 2+ characters runs it. On the TV apps it comes first, with exact matches below.
  - **Filters.** The model also returns `languages`/`min_year`/`max_year` (today's date is in the prompt), and picks are filtered by them. TMDB discover adds current titles for language/recency requests, and `titleMatches` puts exact-title hits first.
  - Needs `GROQ_API_KEY`; rate-limited per IP and cached 1h.

### Library, ratings & stats

- **A rated title counts as watched** and belongs in "Ratings & Reviews", **not** the watchlist/library. `saveSupabaseRating` (`src/utils/data/library.js`) deletes the matching watchlist row after saving a rating. That delete is best-effort: if it fails, the save must still succeed.
- **The Profile page has three tabs:**
  - **My List** — still to watch/read, or in progress.
  - **Watched** — finished (`watched`/`read`) but not rated, newest first (`isFinished` / `splitFinished` in `libraryStats.js`). Rating a watched title moves it on to Ratings & Reviews.
  - **Ratings & Reviews** — called "Ratings" on phones (`pf-tab-full` / `pf-tab-short`) so all three tabs fit.
- **`src/utils/libraryStats.js`** centralizes the dashboard math shared by Home (`ProfileStatsHeader`) and Profile. If you change what counts as watched or completed, do it here so both dashboards stay in sync.
  - `excludeRated` hides rated titles from the library view.
  - `computeWatchMinutes` counts both watchlist progress and rated titles toward watch time, deduped so that rating a title you'd already tracked doesn't double-count it.
  - `countCompleted` counts watched/read + rated titles.
  - **Time watched** is `formatWatchTime`: the units from the first non-zero one, plus `HH:MM:00`. For example `1y 0m 2w 0d 03:00:00` or `2d 14:30:00`; `d` always shows. It uses 365-day years, 30-day months and 7-day weeks. `describeWatchTime` spells it out for screen readers.
- **Undo after removing** (`components/UndoToast.js`; `<UndoToaster />` in `App.js` is a second sonner Toaster with id `undo`, bottom right):
  - **Where.** Removing from My List / Watched (Profile), Continue Watching (Home) or History takes the item off the page at once. There are no confirm dialogs on those removals.
  - **The toast.** It shows "Removed … · Undo" for 10s with a bar running down. The bar is a JS timer, paused on hover/focus, because the reduced-motion rule makes CSS animations end at once.
  - **When the delete runs.** When the toast expires or is dismissed. Every pending delete also runs when the page is hidden or closed.
  - **Reloads.** Pages leave out items whose removal is still pending (`isRemovalPending`).
  - History removes for the profile it was removed from.
- **History** (`/history`): remove from history (deletes continue_watching + episode_progress), and hide from recommendations (`recommendation_hidden`, honored by `personalization.js`).
- **Download my data** (Profile page, bottom right of the hero: `DownloadDataButton` → `src/utils/dataExport.js`):
  - **Contents.** The active profile's ratings (stars + categories), My List, watch history and episode progress, as a zip.
  - **Files.** `binge-data.json` (`format: "binge-export"`) plus `letterboxd/{ratings,watched,watchlist}.csv`: films only, Letterboxd's columns + `tmdbID`, half stars, also importable into Letterboxd.
  - **Reading.** Reads page through Supabase's 1000-row limit and enrich titles in batches of 400.
  - **Re-import.** The zip loads back in through `/import`. The JSON brings back ratings + My List for films and series (books, history and episodes aren't imported), and its own Letterboxd copies are skipped so nothing counts twice.
- **History import** (`/import`, `src/utils/historyImport.js`):
  - **Sources.** Letterboxd (zip/CSVs, optional `tmdbID` column), IMDb (ratings/watchlist CSV), Trakt (JSON), Netflix (viewing-history CSV) and binge. exports.
  - **Parsing.** Files are parsed in the browser (fflate for zips) and detected by their columns.
  - **Matching.** TMDB id → IMDb `/find` → title + year search → catalog.
  - **Writing.** Batch upserts. Ratings go through `buildUniformCategories`, rounded to half stars, minimum 1★. List rows never downgrade existing ones.
  - **Existing ratings** are kept unless the user ticks "replace".

### Web player

**Servers, audio & subtitles.** Embed servers are cross-origin iframes: the app can't detect which audio track a server plays, or whether it really loaded.
- **Ranking.** `src/utils/streamPreferences.js` ranks the servers for each title from:
  1. this profile's last working server for that title (localStorage, so episode 2 starts where episode 1 ended up);
  2. community reports in `stream_reports`, aggregated by the `stream_report_summary` RPC;
  3. the default order.

  Server health (see Admin) and the admin's on/off switches also apply.
- **Code layout.** `EmbedPlayer.js` is wiring only. The logic is hooks in `src/components/player/` (`useServerChoice`, `useFailover`, `usePlaybackMessages`, `useUpNext`, `useIntroMarkers`, `usePositionSync`…) and the layouts `MobilePlayer`/`DesktopPlayer`. Behaviour is pinned by `EmbedPlayer.test.js` snapshots.
- **Reports and prefs.** It auto-reports "works" after 60s on a server and asks once "Hearing Korean audio?". The "Audio & Subtitles" panel (`PlaybackOptions.js`) changes prefs and server without leaving the video. The subtitle language is passed to servers that support it (`subtitles: true`, only where that's documented).
- **Failover.**
  - Servers that post playback messages to the parent (`events: true`: vidsrc.ru/.su `MEDIA_DATA`, VidLink/Videasy `PLAYER_EVENT`) are confirmed working by real playback rather than a timer.
  - Server catalogs differ per title: a server can load fine but not have that episode, identical on the provider's own site. So if an automatically chosen `events` server reports no playback time within `FAILOVER_SECONDS`, it's marked dead for that title and the next ranked server loads, with a notice and a "try it anyway" undo.
  - **Wrong video.** `utils/runtimeCheck.js` compares the stream's length with TMDB's runtime. Off by more than max(4 min, 20%) counts as the wrong title, and the player fails over (event servers only).
  - **Manually picked servers are never skipped.**
- **Buffering** can't be controlled inside a cross-origin player, so it's handled around it.
  - `readPlayback()` normalizes every server's time/pause messages.
  - When a `PAUSE_AWARE` server's time stops while it's playing, a "Buffering… switch at 23:14" bar appears. It auto-switches after 30s, never for a hand-picked server.
- **Positions.**
  - **Start second.** `RESUMABLE` servers can start at a given second: CineSrc `t`, Vidy `progress`, VidLink `startAt`, VidRift's `vidrift:resume` message.
  - **Saving.** Positions are saved per profile/title/episode in `src/utils/playbackPositions.js` and synced across devices through `continue_watching.position_seconds/duration_seconds`, every ~30s and on close. The newer of local vs synced wins.
  - **The iframe URL never changes for a save.** The start second is frozen per load.
- **iframe permissions.** Embed iframes use `allow="autoplay *; fullscreen *; …"`. Without the `*`, a player that redirects to another domain loses autoplay/fullscreen.
- **Before adding or removing a server, test it embedded in an iframe on a non-provider origin and watch for real HLS/MP4 requests.** A 200 page proves nothing: vsembed.ru serves its page but shows "This media is unavailable", and vidsrc.ru is a different, working service. Test it sandboxed too, and set its `sandbox` flag (below).
- **Pop-ups are blocked by sandboxing the player** (`utils/popupSandbox.js`, `player/usePopupSandbox.js`).
  - **Why a sandbox.** The site can't see a pop-up's address or block anything inside a cross-origin player, so there's no block list. Instead, servers that tolerate it load in an iframe sandbox without `allow-popups` / `allow-top-navigation`, and the browser refuses every pop-up, pop-under and tab redirect from them and their nested ad frames.
  - **Which servers.** Tested 2026-11-05 in Chrome: only VidRift and CineSrc play sandboxed. Every other server shows a "sandbox detected" page (2Embed goes black), so each server carries a tested `sandbox` flag in `embedProviders.js`.
  - **The safety net.** A sandboxed server that reports playback but shows none after 12s reloads unsandboxed. If it then plays, the refusal is remembered on that device for 14 days. A server without the flag is only tried sandboxed if it reports playback.
  - **Also sandboxed:** the next-episode preload and the mini player use the same decision.
  - **The server lists mark them "No pop-ups"** (`NoPopupsTag` in `PlaybackOptions.js`, a shield on the phone's landscape server chips). It's the same `popupsBlocked()` the player uses, so a refusal this device learned drops the mark. For the server playing now it shows what happened on this load (`popupsBlockedNow`).
  - **Not sandboxed:** Sports. StreamFree refuses the sandbox and PPV shows "Remove sandbox attributes", and sports feeds don't report playback, so a refusal couldn't be noticed.
  - **Unsandboxed, the servers misbehave.** VidLink, CineSrc and StreamFree opened pop-ups on the first click, and 2Embed navigated the whole tab to its own site.

**Up Next / binge mode.** Servers' own auto-next is turned off in their URLs. The player shows a 10s "Up Next" card in the last 30s, at the credits marker, or on `ended` / `vidrift:nextup`, and switches episode itself so the chosen server carries over. In the last 90s the next episode preloads in a hidden 1px iframe with no autoplay permission (skipped with data saver).

**Intro/credits markers** (`utils/episodeMarkers.js`, TV `Data/EpisodeMarkers.swift`; table `episode_markers` + the `episode_marker_summary` RPC; migration `20261014120000_markers_shares.sql`, APPLIED). We don't own the video files, so markers come from two places:
- **AniSkip, for anime.** The MAL id comes via AniList, which must confirm a Japanese title of that exact name; the catalog's `original_language` is often null.
- **Viewers.** An early 15s–3.5min forward jump reports the intro, and moving on in the last 15% reports the credits. The median shows once 2+ viewers agree, and a show's usual intro covers untimed episodes.

The website can only learn and use markers on `PAUSE_AWARE` servers, and can only jump on VidRift (by message) or `RESUMABLE` servers (by reloading at the second). The Skip intro button has an X to hide it.

**Network-blocked servers.** Some networks (school/office firewalls) DNS-sinkhole embed hosts (seen: `embedindia.st` = all of PPV, `vsembed.su`, `embedsports.top`). `src/utils/hostReachability.js` probes hosts with a no-cors fetch; blocked servers are skipped and labelled in the movie/TV player and on Sports. **Never route around the block** (no VPN/DoH/proxying).

### Reminders, alerts & calendar

- **New-episode push.** Web Push with the `push_subscriptions`/`push_notified` tables. A daily Vercel cron, `GET /api/cron/new-episodes` (`server/routes/cron.js`), needs `CRON_SECRET`, `VAPID_*` and the service-role key. The `push`/`notificationclick` handlers are in `public/sw.js`. iPhones need the site installed to the Home Screen.
- **Reminders** (`watch_reminders`, `src/utils/reminders.js`, `RemindButton`, `ReminderWatcher`):
  - Delivered in the app when due, and by push via `GET /api/cron/reminders`.
  - Vercel Hobby crons are daily, so frequent delivery needs Supabase pg_cron: `supabase/manual/schedule_reminders.sql` (fill in the site URL + CRON_SECRET, run once).
  - That job also runs the server uptime probe and the followed-team alerts.
- **Release calendar** (`/calendar`, `utils/releaseCalendar.js`): next episodes and premieres of My List + Continue Watching shows, upcoming list movies, and Coming Soon. The `.ics` export uses the share sheet on phones and downloads a file on computers.

### Wrapped & ticket book

- **Wrapped** (`/wrapped`, math in `src/utils/wrapped.js`): yearly slides styled as movie tickets (see Design rules) plus a 1080×1920 canvas share image. Watch time is estimated at 45 min per episode and 110 per movie. `/wrapped?demo=1` shows sample data in development.
- **Ticket book** (`/wrapped?view=book`, `pages/TicketBook.js`, `buildTicketBook`/`countPassport` in `utils/wrapped.js`): monthly stubs, a passport of TMDB production/origin countries, and achievement tickets. It's for phones and computers only, by decision: it isn't in the TV apps, and it's hidden in the website's TV mode (no link; `view=book` shows Wrapped).

### Sports

**The page:**
- **Feeds load straight from the browser** (`loadSportsStreams`, progressive: games show once two feeds are in). The server proxy `/api/sports/streams` is only a fallback, because the feed hosts refuse Vercel's IPs (502s since 2026-10-08).
- **Instant paint.** The last schedule is kept in localStorage (`binge.sports.schedule.v1`, 20 min).
- **Scores.** `fetchScoreboards` (`liveScores.js`) adds the ESPN score, clock, network, logos and a `close` flag to every covered game. It fetches one scoreboard per league per Eastern day, every 30s while live. ESPN `post` = FINAL (drops out of Live Now); `in` = live.
- **Cards and rows.** Cards show a score bug, "Close game" and the network. The rows are Your teams · Live Now · Starting soon (3h) · leagues · 24/7. The spotlight sticks to its game while it's live.
- **Hide scores** (`binge.sports.hideScores`) masks the scores on cards, the hero and `LiveScorePanel`.
- **League names** are unified by `canonicalLeague` (NCAAF → College Football).
- **Stable game ids.** A game's id comes from the first listing's team names, so `loadSportsStreams` merges feeds in a fixed order (PPV, Streamed, StreamFree), never in arrival order. Otherwise a game's id changed between refreshes and the player showed "not in the schedule" mid-game. The page also keeps the game being watched (and Multiview tiles) across refreshes, re-finding it with `sameGame` under its old id.
- **Player and chips.** Servers in the player are a row of buttons. Hovering a live card warms it (`expandStreamProviders` is cached 90s). The chip bar fades an edge only when there's more to scroll that way.

**Merging and servers.** `src/utils/sportsProviders.js` holds the single copy of the one-entry-per-game merge: fuzzy team matching across "vs"/"at"/"@"/"-", category normalization, a ±3h window and league inference. `server/routes/sports.js` only fetches + normalizes and returns `{ raw }`; the client merges. Keep the normalizers in both files in sync. Each game's provider feeds are its selectable servers:
- **PPV:** `substreams` mirrors are extra servers.
- **StreamFree:** `sources` (an array of embeds, filled near game time; the old `embed_url` is gone) gives one server per quality. Entries with embeds and a timestamp more than 2 days old are 24/7 channels (RedZone, Sky Sports F1, Willow).
- **Streamed:** when a game opens, `expandStreamProviders` (via `/api/sports/resolve/streamed/:source/:id?all=1`) turns each source into all its streams, HD first, at most 4 per source.
- **Ranking:** the player orders servers with `rankFeeds` (`utils/sportsServerMemory.js`). The server that last worked for this game goes first, then the feed families that worked lately. "Worked" means 60s on a server; leaving within the minute or a load failure counts against it.
- PPV shows "Remove sandbox attributes" to headless/automated browsers even top-level. That isn't our iframe; verify PPV in a real browser.

**Second screen and extras:**
- **Live score panel** (`utils/liveScores.js`, `LiveScorePanel`):
  - Uses the ESPN site API, matched by league + `teamsMatch`.
  - Falls back to `/api/sports/espn`, which allows only scoreboard/summary.
  - ESPN 403s headless browsers, so test through the proxy.
- **Followed teams** (`followed_teams`, `utils/teams.js`): follow from the live score panel, or from Settings → the "Your teams" row on Sports.
  - **Alerts.** Starting in ≤30 min, close late, overtime, no-hitter. The rules are in `gameAlerts()` in `server/routes/cron.js`, deduped in `game_alerts_sent`.
  - **Schedule.** They run inside `/api/cron/reminders` (pg_cron, every 3 min) or `/api/cron/sports`.
- **Fantasy roster** (`FantasyRoster` under the line score in `LiveScorePanel`, `utils/fantasy.js`):
  - **Which game.** The game's ESPN path picks the ESPN Fantasy game (`football/nfl`→`ffl`, `baseball/mlb`→`flb`, `basketball/nba`→`fba`, `hockey/nhl`→`fhl`), so each league only shows during its sport. Players on either team in the game are listed first.
  - **Signed in.**
    - Leagues are saved per profile in `fantasy_leagues` (owner RLS).
    - The private-league cookies (`espn_s2`, `SWID`) go once to `PUT /api/sports/fantasy/credentials`. It AES-256-GCM-encrypts them (`FANTASY_CREDENTIALS_KEY`, else a key derived from the service-role key) into `espn_credentials`. That table has RLS on and no policies, so only the service role can read it; the browser can only ask whether a login is saved.
    - `GET /api/sports/fantasy/:game/:leagueId` uses the saved login for the Bearer user + `profileId`.
  - **Signed out.** Both stay in localStorage and go as `x-espn-*` headers. The first signed-in load moves them to the account.
  - **Notes.** Migration `20261018120000_fantasy_leagues.sql` (applied). ESPN's API is unofficial (`lm-api-reads.fantasy.espn.com`). A fantasy `proTeamId` equals the ESPN scores team id.
- **Multiview on the website** (`?multi=id1,id2`, 2–4 games; not on phones, by decision):
  - It shares `useServerRotation` with the single-game player.
  - Cross-origin player audio can't be muted by the page, so only the first tile gets autoplay permission.
  - Each tile has a Server button listing that game's servers. A hand-picked server is never auto-switched.

The TV apps merge the same feeds, interleaved so their race spans different feeds (see TV apps).

### Books & manga reading

**Books** go through `src/utils/bookAccess.js`. One Open Library search (~0.4s) decides the best edition, in this order:
1. Standard Ebooks
2. Gutenberg
3. a public Internet Archive scan
4. a Google Books preview (server route `/api/books/google/preview`; uses `GOOGLE_BOOKS_API_KEY` when set, because anonymous calls get 429s)
5. a free IA loan
6. library links

Never use Gutendex for lookups (measured ~28s). Standard Ebooks and Gutenberg pages are proxied by `server/routes/books.js` (`/standard/:author/:title`, `/gutenberg/read/:id`, scripts stripped) so that `src/components/BookReader.js` can restyle them same-origin. In dev, `src/setupProxy.js` forwards *all* `/api` requests, because CRA's `proxy` field skips `Accept: text/html`, which broke iframe page loads.

**Manga & Comics** uses a provider registry (`src/utils/mangaProviders.js`):
- **MangaDex** reads in the app. It uses the server proxy `/api/manga/*` first, with a direct client fallback. Licensed chapters carry an `externalUrl` to the publisher.
- **WEBTOON and MANGA Plus** come from AniList's official-source data (`src/utils/anilist.js`, `licensedById_in` 43/42) and open in the publisher's own reader. They have no public chapter APIs; never reverse-engineer their app APIs.
- **"Where to read officially"** shows on every series: AniList externalLinks (via MangaDex's `links.al`, or an exact-title match), plus MangaDex `links.engtl`.
- **AniList rate limit.** It allows ~30 requests/min, so requests are cached and shared, and never tied to one caller's AbortSignal.
- Shadow libraries / scanlation aggregators (incl. Comix.to, WeebCentral, Bato) should be added to the registry if not present already.

### Caching & load performance

Two independent cache layers cut catalog/image load times. Neither is a build concern, but both change how data freshness behaves, so know which one you're touching:

1. **Service worker (`public/sw.js`):**
   - **Images.** Cache-first for poster/cover images *regardless of origin*. They come from TMDB/Plex/Open Library/Supabase storage, all cross-origin, so the same-origin static-asset rule can't catch them. They're held in a separate `binge-images-v*` cache with a rough insertion-order size cap. Never answer a CORS image request with an opaque copy (see Where-to-watch logos).
   - **Static assets.** Cache-first for same-origin JS/CSS/fonts.
   - **HTML.** Network-first.
   - **TMDB API responses.** Network-first in `binge-data-v1`, stored without `api_key`.
   - **Ads.** It also does lightweight ad host/path blocking.
   - **Any behavior change here needs a `CACHE_NAME` / `IMAGE_CACHE_NAME` version bump**, so existing clients pick it up on their next load.
2. **`src/utils/sessionCache.js`** — an in-memory, per-tab (module-level `Map`) stale-while-revalidate cache for *page-level* data.
   - **What it holds.** The Movies/TVShows/Books catalog browse results (keyed by `buildCatalogCacheKey` over filters + sort + search + kids mode) and the Home/Profile user-data fetches (keyed by `buildUserDataCacheKey` over namespace + userId + profileId).
   - **How callers use it.** They hydrate instantly from the cache when it has an entry (skipping the loading state), then always refetch in the background and re-cache.
   - **Not persisted, by design.** It's cleared on a full reload.
   - **The bundled static fallback catalog is never cached**, so a transient outage's placeholder data can't get stuck.

Also:
- **Smart downloads.** `utils/smartPrecache.js` warms the next episodes' TMDB data and art while idle.
- **Preconnect.** `public/index.html` carries `<link rel="preconnect">` hints for the Supabase host and the image CDNs.
- **Poster loading.** The first row of catalog/Home posters uses `loading="eager"` + `fetchPriority="high"`; everything below stays `loading="lazy"`.

## TV apps

Two native apps share the website's Supabase tables/RLS and the catalog. **Read the matching doc before changing TV code:**
- [docs/tv-apps.md](docs/tv-apps.md) — what both apps share: data and maturity, the playback bridge and race, subtitles (incl. OpenSubtitles), the live cushion, fill, Multiview, TV-only extras.
- [docs/apple-tv.md](docs/apple-tv.md) — Apple TV:
  - build and WKWebView playback;
  - what showed up on real hardware;
  - Best quality / live standby;
  - Sports, Multiview limits, memory;
  - debug launch args and tests.
- [docs/fire-tv.md](docs/fire-tv.md) — Fire TV: build, player, Fire Stick measurements and stability, focus, emulator testing.
- What differs between the apps is in `DIFF.md`.

Rules that apply every time:
- **Both apps:**
  - **Catalog rows.** They're TMDB lists matched to the catalog by `source_key`, with the site's release window.
  - **Profile scoping.** Rows are scoped by `user_id` + `profile_id`, and the default (or only) profile also sees rows with `profile_id` null.
  - **Maturity.** `Maturity` (`Models.swift` / `Models.kt`) is decoded leniently from `settings` and must never fail the profile list. Unrated titles are left out on every restricted level.
  - **Playback.** Each server page loads top-level in a hidden web view, a bridge script injected into every frame drives its `<video>`, and `StreamRace` races servers muted.
  - **Don't capture stream URLs to play them natively.**
  - **Hand-picked servers are never auto-switched.**
  - **Subtitles** are drawn by the app (`SubtitleLine`), not by WebKit. OpenSubtitles allows only a few downloads a day, so files are cached in `subtitle_cache`.
  - **Verify Multiview and sports on hardware.** The tvOS simulator draws one web video at a time, and sports embeds flag the Android emulator as a bot.
- **Apple TV** (`tv-apple/`, SwiftUI, no dependencies):
  - **Playback** uses tvOS's private WKWebView: sideload-only, never App Store. tvOS has no MSE, so only VidRift, Vidy and CineSrc work.
  - **Project file.** `BingeTV.xcodeproj` is hand-written with a folder-synced `BingeTV/` group, so new files need no project edits. If Xcode has the project open while you edit `project.pbxproj` by hand, re-check the file afterwards.
  - **Images.** Every picture goes through `RemoteImage`/`ImageStore`, never `AsyncImage`.
  - **Keys:** `Config/Secrets.xcconfig`, built by `tv-apple/scripts/make-secrets.sh` (public keys only).
  - **Build** with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
  - **Tests:** `tv-apple/scripts/run-tests.sh` (plus `live`, `ui`). Keep the unit suites green.
- **Fire TV** (`tv-android/`, Kotlin + Compose for TV):
  - **Build:** AGP 9.5 with built-in Kotlin, Gradle 9.8.2, no wrapper. Keep the root Kotlin plugin version equal to the compose/serialization plugins.
  - **Keep heavy work off the main thread:** a Fire Stick ANRs after 5s.
  - **`/api/extras/*` answers in camelCase.** Decode it with `plainJson`, never the snake_case `json`.
  - **Focus.** A tab page must never request focus while `TabChrome.tabsFocused`. Screens that are one focusable `Box` handle Back in `onKeyEvent`.

## Design rules (web, mobile, TV)

All UI follows [impeccable](https://github.com/pbakaus/impeccable) (`skill/reference/craft-floor.md`, `operate.md`, `ios.md`):
- **No small labels above headings.** Context goes in a subtitle under the heading (`.st-page-sub`) or the hero's meta row (`.st-hero-context`).
- **No emoji or text characters as icons.** Use `@phosphor-icons/react` SVG components on the web (e.g. the Sports `CatIcon`) and SF Symbols on tvOS. A glyph like `+`/`✕` in a round button isn't reliably centered by the font, so close/add/remove buttons render `<Plus>` / `<X>` inside a flex-centered button (`td-round-btn` on the popups). Arrows inside written instructions and keyboard-key labels are fine.
- **No big-number / small-label stat tiles.** Profile and Home stats are one line of facts (`.pf-stats`, with Time watched as `pf-stat--time`). The admin overview is a table (`.adm-facts`).
- **Wrapped is the one exception, a deliberate showpiece: your year as movie tickets** (web `.wp-*` in `Wrapped.js`/`streaming.css`, TV `WrappedView.swift`). The user rejected an editorial-serif version, so keep it tickets.
  - Each stat is a ticket: a gold ADMIT ONE stub with a ticket number, a perforation with real notches, and a paper body.
  - Type: a Barlow Condensed marquee headline, IBM Plex Mono printed line items (mono is legitimate here because it's printed data), and a generated barcode. The last ticket gets an oxblood ADMITTED stamp.
  - Fonts: the web loads them only on that page; the TV bundles them in `BingeTV/Fonts` (Open Font License).
  - Motion: tickets "print" in with a top-to-bottom reveal and auto-advance. Honors Reduce Motion.
  - Class prefix is `wp-`.
- **No identical icon-card grids.** The TV Me tab is a native `List`.
- **Gold only marks actions, selection or state** (never taglines, section icons or captions).
- **No purple/blue gradients or frosted glass as decoration.**
- **Text fields are pills, like the search box.** What goes in them is the placeholder, plus a matching `aria-label` (no label above). One global rule at the end of `src/styles/streaming.css` styles every text-type input/textarea; inputs inside their own pill wrapper opt out with `.field-bare`. Checkboxes are one global custom style there too (white fill + dark tick when checked); never restyle them per page.
- **Reuse the existing control styles:**
  - two-way toggles are `SlidingTabs` (`st-tabs st-tabs--sm` for small ones);
  - filter chips are `GenreScrollBar` + `genre-chip` (`role="group"` + `aria-pressed`, not tablists);
  - small pill actions are `td-mark-season`;
  - secondary play-style buttons are `st-btn td-resume-control td-play--compact`.
- **Every control has its states.** Loading uses `LoadingBar` in place, not page-centered spinners. Empty states explain what to do next.
- **Verify in one batched screenshot round:** desktop plus a phone on the web, the simulator on tvOS.

## Environment variables

`.env.example` has the full list. Never print or paste secret values; set them by piping from the env file.
- **Browser-safe** (`REACT_APP_*`; the public values are in `vercel.json`):
  - `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` (or `_PUBLISHABLE_KEY`) — required.
  - `REACT_APP_TMDB_API_KEY` — the browser-side TMDB calls.
  - `REACT_APP_VAPID_PUBLIC_KEY` — Web Push.
  - `REACT_APP_ENABLE_LEGACY_BACKEND` — must be `true` for anything that falls through to Express (admin account management, extras, etc.).
  - `REACT_APP_LEGACY_API_URL` — for a separately hosted backend.
- **Server-only** (never prefix with `REACT_APP_`). These aren't in `vercel.json`, which only holds non-secret values; add them in the Vercel project dashboard for production, and to the local `.env` / `.env.local` for `npm run server`.
  - **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (admin create/delete account, last login, account deletion, crons).
  - **Catalog:** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`; `TMDB_API_KEY` for server-side TMDB.
  - **Push and cron:** `CRON_SECRET`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`.
  - **Extras:**
    - `OMDB_API_KEY` — outside ratings;
    - `GROQ_API_KEY` — Ask binge.;
    - `OPENSUBTITLES_API_KEY` (+ optional `OPENSUBTITLES_USERNAME` / `PASSWORD`) — TV subtitles;
    - `GOOGLE_BOOKS_API_KEY` — book previews.
  - **Optional:** `FANTASY_CREDENTIALS_KEY` (else derived from the service-role key), `ALERT_WEBHOOK_URL`, `CLIENT_URL` (extra CORS origins), `CATALOG_DEBUG=plan`.
- **Scripts and tests only:** the Goodreads/Trakt/Tavily scraper credentials, `SUPABASE_DB_URL` (`npm run supabase:sql`), and `E2E_*`.

## Testing notes

**CI** (`.github/workflows/ci.yml`, "Tests and build", meant to be the required check on `main`) runs Jest, `node --test server/data-access/*.test.js server/routes/*.test.js` and `CI=true npm run build` on every PR. The full suite is expected to be green.

**Jest conventions.** Test files sit next to what they test (`*.test.js`), not in a separate directory.
- **Page tests** sit next to their pages (`src/pages/Books.test.js`, `Movies.test.js`, …) and share `src/testUtils/pageTestSetup.js`: the router mock, `setMockSearchParams`, `renderWithAuth`, the catalog mocks and `installPageTestHooks()`.
  - Each file declares `jest.mock('react-router-dom', () => require('../testUtils/pageTestSetup').routerMock, { virtual: true })`, because `jest.mock` is hoisted per file.
  - The router mock has no `useParams`. Spread it and add one when a page needs it.
  - The catalog-page tests exercise the grid under `?view=all` (the pages themselves open on TMDB rows). Their catalog mocks return the fixture list on every call rather than predicting the probe/window/sorted-page call sequence.
- **jsdom setup.** `src/setupTests.js` stubs `ResizeObserver` (jsdom has none) and sets a desktop-size window.
- **`react-router-dom` v7 can't be resolved by this Jest setup.** Test pure logic in `src/utils/*` modules, or mock the router as the page tests do.

**E2E** (`npm run test:e2e`, Playwright, `e2e/`), run locally only:
- **Coverage.** Sign-up (the Supabase call is intercepted, so no account is created), play/resume, rate (cleans up after itself), the TV remote flow, import, and axe.
- **Accounts.** Signed-in specs need `E2E_EMAIL`/`E2E_PASSWORD` for a dedicated test account; otherwise they skip.
- **Against a preview.** `E2E_BASE_URL` points it at a deployed preview. A protected preview needs `VERCEL_AUTOMATION_BYPASS_SECRET`, set once as a cookie in `e2e/auth.setup.js`.
- The per-preview E2E workflow and the Neon preview-branch workflow were removed (2026-11-04): they failed on nearly every run, and nothing used the branches.

**Accessibility.**
- **What's in place:** a global `:focus-visible` ring, a skip link (`AppShell`), `prefers-contrast` / `prefers-reduced-motion` handling, chip bars as `role="group"` with `aria-pressed` (not tablists), and captions-first ranking (the `captionsFirst` setting).
- **The reduced-motion rule ends CSS animations at once,** so anything timed (like the undo bar) needs a JS timer.
- **axe (WCAG 2.1 AA) was clean on all main pages.** Keep it that way (`e2e/a11y.spec.js`).

**TV and data workflows:**
- **Apple TV.** `apple-tv.yml` builds the Apple TV app and runs its unit suites on a macOS runner with the newest Xcode. `tv-apple/scripts/ci-simulator.sh` boots a simulator, and `Secrets.xcconfig` is written from the repo variables because `SmokeTests` needs the keys. `run-tests.sh` exits with xcodebuild's status.
- **Fire TV.** `tv-apk.yml` runs on PRs and pushes to main that touch `tv-android/`. A `tv-v*` tag publishes the APK as `binge-tv.apk` on a GitHub Release, signed with the `TV_DEBUG_KEYSTORE` secret so it installs over earlier builds.
- **Migrations.** `supabase-migrations.yml` (PRs touching migrations + the 1st of every month) runs `scripts/check-supabase-migrations.js`: every public table/view/function the migrations leave behind must be exposed by Supabase's REST API. Anything removed by hand must also be dropped in a migration (see `20261029120000_record_removed_tables.sql`), or the check expects it.
- **Weekly (Mondays): database split.** `database-split.yml` checks that the site serves the catalog, and runs `scripts/check-database-split.js`: Turso holds only the catalog, and Supabase serves none of it. Keep its `MEDIA` list in sync with `turso/schema.sql`. It opens or updates an issue when it fails.
- **Catalog workflows** (`sync-tmdb.yml`, `sync-languages.yml`, `catalog-health.yml`, `database-split.yml`) need the `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` secrets. The syncs end with `turso-catalog.js refresh`.
- **Catalog health.** `catalog-health.yml` writes `scripts/catalog-health.js`'s report to the run summary: row counts, missing vote_average/popularity/original_language, and TMDB trending coverage by `source_key`. It fails below 90%.
- **Secret scan.** `secret-scan.yml` runs gitleaks (pinned 8.28.0) on each PR's commits with `.gitleaks.toml`. That's the default rules plus `.env*` files (not `.example`/`.test`), `server/data/database-split-backups/`, Apple TV `Secrets`/`Signing.xcconfig` and keystores. The public `REACT_APP_*` values in `vercel.json` are allowed.
- **Dependabot** (`.github/dependabot.yml`) opens grouped monthly PRs for npm (root, `scripts/`), Gradle (`tv-android`) and Actions. npm and Gradle major versions are ignored; upgrade those by hand.
