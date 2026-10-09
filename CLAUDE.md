# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**binge.** — a media-tracking web app for movies, TV shows, and books. Users track what they watch/read, rate titles, and get personalized picks from a local taste-matching algorithm. React 19 + React Router 7 frontend, Supabase (Postgres + Auth + RLS) as the primary data layer, with a secondary Express backend deployed as Vercel serverless functions for the handful of operations that need elevated (service-role) privileges.

## Commands

```bash
npm start                 # runs client (CRA dev server) + Express server concurrently
npm run start:client      # CRA dev server only (port 3000, proxies /api to :5001 — see "proxy" in package.json)
npm run server            # Express server only (server/index.js, port 5001)
npm run build             # production build (react-scripts build) — CI=true build treats warnings as errors
npm test                  # Jest/RTL in watch mode
CI=true npx react-scripts test --watchAll=false                    # run the full suite once, non-interactive
CI=true npx react-scripts test --watchAll=false src/App.test.js    # run a single test file
```

There is no separate lint script; ESLint runs as part of `react-scripts build`/`test` via the `react-app` config in `package.json`. A `CI=true` build fails on any ESLint warning (e.g. unused vars) — always do a `CI=true` build after removing code, not just a normal one.

### Data import / seeding scripts

The repo also owns the pipeline that populates the Supabase catalog tables (movies/tv_shows/books) from external sources. These are standalone Node scripts, not part of the app runtime — see `npm run` entries prefixed `import:*`, `generate:supabase:*`, and `supabase:*` in `package.json` (Goodreads, TMDB, Plex, Internet Archive, Open Library scrapers/importers, and `scripts/run-supabase-sql.js` for applying `supabase/repeatable_schema.sql` + seed files). Only touch these when the task is specifically about catalog data, not app features.

## Architecture

### Supabase-first, Express as a privileged fallback

This is the one thing every route/feature decision hinges on. There are two ways data gets to the frontend:

1. **Direct Supabase calls** (the default path) — most of the app calls functions in `src/utils/supabaseData.js` directly, which use the Supabase JS client (`src/utils/supabase.js`, anon/publishable key) straight from the browser, protected by Postgres Row Level Security policies (see `supabase/repeatable_schema.sql`).
2. **The `api` object** (`src/api.js`) — a smaller set of routes go through `api.get/post/put/patch/delete(path, body)`. Internally this tries `executeSupabaseRoute()` (`src/utils/supabaseApi.js`, a client-side router that reimplements a handful of REST-shaped endpoints — search, media details, profile, admin — as direct Supabase queries) first. If that returns `null` for a given path, it falls through to `requestLegacyApi()`, which hits the real Express backend at `/api/...`.

The Express backend (`server/app.js` + `server/routes/*.js`) is deployed unconditionally as a Vercel serverless function (`api/index.js` re-exports `server/app`; `vercel.json` routes `/api/(.*)` to `api/[...slug].js`). Whether the **frontend** is allowed to fall through to it is gated by `REACT_APP_ENABLE_LEGACY_BACKEND` (or `REACT_APP_LEGACY_API_URL` for a separately-hosted backend) — see `src/api.js`. Production (`vercel.json`) has this set to `true`.

**When you add or change a route, decide deliberately which path it belongs on:**
- If it only needs the anon key + RLS, implement it as a plain function in `supabaseData.js` (called directly) or as a branch in `supabaseApi.js`'s `executeSupabaseRoute` (called via `api.*`).
- If it needs the Supabase **service-role key** (anything under `supabase.auth.admin.*` — creating/deleting auth users, reading `last_sign_in_at`, etc.), it can *only* live in the Express backend (`server/routes/*.js`), since the service-role key must never reach the browser. Make the matching branch in `supabaseApi.js` return `null` so `api.js` falls through to it (see `/admin/users*` handling for the pattern).

### Auth & profiles

Supabase Auth (email/password) is the identity system. A Postgres trigger, `handle_auth_user_changed` (`supabase/repeatable_schema.sql`), fires on insert/update to `auth.users` and auto-creates/updates the matching `public.profiles` row from `raw_user_meta_data` (username, bio, `is_admin`, `is_dev`). Every user-owned table has its `user_id` FK to `auth.users(id)` declared `on delete cascade` — deleting the `auth.users` row (via the service-role `auth.admin.deleteUser` call) is sufficient to cascade-delete a user's profile, ratings, watchlist, etc. There's no separate "delete profile" step needed.

`src/contexts/AuthContext.js` wraps Supabase auth-state changes and exposes `user` (with `isAdmin`/`isDev` resolved via `src/utils/userAccess.js`), `signIn`, `signUp`, `logout`, etc. `src/components/ProtectedRoute.js` gates routes; `allowedUserTypes` restricts by role (see `/admin/requests` in `src/App.js` for an admin-only route).

### Title / book detail modals

`MediaDetailsModal.js` (movies/TV) and `BookDetailsModal` in `Books.js` are single responsive components (`td-*` classes in `src/streaming.css`) — the separate `MobileMediaDetail`/`MobileBookDetail` forks were removed. The movie/TV modal pulls backdrop, logo art, cast, certification, trailer and season/episode lists from TMDB (`src/hooks/useTitleDetails.js`). Image sizing goes through `src/utils/imageQuality.js` (TMDB srcsets, full-size Goodreads/Open Library covers).

### Book ids must stay below 2^53

Book ids were SHA-1-derived 60-bit numbers that JavaScript silently rounds (opening/saving books hit the wrong id). `scripts/generate-supabase-book-seed.js` now emits 52-bit ids; `supabase/migrations/20261007140000_book_ids_js_safe.sql` remaps existing rows (`id >> 8`). Any new id scheme must stay within `Number.MAX_SAFE_INTEGER`.

### Desktop / mobile component pairs

Several components render a completely different implementation on mobile rather than just using responsive CSS: `MediaCard.js` → `MobileMediaCard.js`, `MediaDetailsModal.js` → `MobileMediaDetail.js`, and book details have their own `MobileBookDetail.js`. The split is driven by `useIsMobile()` / `useDeviceType()` (`src/hooks/`). When changing behavior on one of these (e.g. adding/removing an action button), check whether the mobile counterpart needs the same change — they don't share implementation.

### Routing & lazy loading

`src/App.js` is the single route table. All page components are `React.lazy`-loaded. Routes needing auth are wrapped in `<ProtectedRoute>`; admin-only routes additionally pass `allowedUserTypes={['admin']}`.

### Browse rows, recommendations & release window

Movies/TV land on a Netflix-style rows view (`src/components/BrowseView.js`: `BrowseHero` spotlight + `TitleRow`s of `TitleCard`s); `?view=all` or `?genre=` switches those pages to the older filterable grid (`CatalogView` inside `Movies.js`/`TVShows.js`). Home uses the same components.

- **Rows come from live TMDB lists, matched back to catalog rows.** The catalog's own `popularity`/`vote_average` are a stale import snapshot and null for many big titles, so `src/utils/browseRows.js` defines each row as a TMDB query (`src/utils/tmdb.js`, browser-side, public `REACT_APP_TMDB_API_KEY`, 30-min sessionStorage cache) plus a catalog-table fallback (`fetchCatalogBrowseRow`). `src/utils/catalogLookup.js` maps TMDB ids to catalog rows via `source_key = 'tmdb:{movie|tv}:{id}'` (unique index), dedupes, applies the release window and kids filtering. Coverage measured ~95–100%.
- **Personalization** (`src/utils/personalization.js`): history = ratings (signed — low ratings push similar titles down) + Continue Watching + episodes watched + watchlist, recency-weighted. Strongest recent positives become "Because you watched X" seeds that pull TMDB `/recommendations` for that exact title; a genre + original-language taste profile scores candidates and also orders the taste rows (`orderRowsForTaste`). Already watched/rated/saved titles are excluded. `src/utils/recommendations.js` is the older genre-sampling engine, still used for books and the chat route.
- **Release window** (`src/utils/releaseWindow.js`): released → shown; releasing within 30 days → shown with a "Coming Soon" badge; later → hidden. Apply it to any new browse surface.
- **Mouse-only rule:** every horizontal scroller must have real ‹ › buttons (`TitleRow`, `BrowseHero`, `GenreScrollBar`), not just swipe/trackpad scrolling.

### Player servers, audio & subtitles

Embed servers are cross-origin iframes — the app cannot detect which audio track a server plays or whether it actually loaded. `src/utils/streamPreferences.js` ranks servers per title from (1) this profile's last working server for that title (localStorage, so episode 2 starts where episode 1 ended up), (2) community reports in `stream_reports` aggregated by the `stream_report_summary` RPC, (3) default order. `EmbedPlayer.js` auto-reports "works" after 60s on a server and asks once "Hearing Korean audio?"; the "Audio & Subtitles" panel (`PlaybackOptions.js`) changes prefs and server without leaving the video. Subtitle language is passed to servers that support it (`subtitles: true`, only if documented). Servers that post playback messages to the parent (`events: true`: vidsrc.ru/.su `MEDIA_DATA`, VidLink/Videasy `PLAYER_EVENT`) are confirmed as working by real playback rather than a timer. Server catalogs differ per title (a server can load fine but not have that episode — identical on the provider's own site), so the player auto-fails-over: if an automatically chosen `events` server reports no playback time within `FAILOVER_SECONDS`, it's marked dead for that title and the next ranked server loads, with a notice and a "try it anyway" undo. Manually picked servers are never skipped. Buffering can't be controlled inside a cross-origin player, so it's handled around it: `readPlayback()` normalizes every server's time/pause messages; a `PAUSE_AWARE` server whose time stops while playing triggers a "Buffering… switch at 23:14" bar (auto-switch after 30s, never for a hand-picked server), and `RESUMABLE` servers start at a given second (CineSrc `t`, Vidy `progress`, VidLink `startAt`, VidRift `vidrift:resume` message). Positions are saved per profile/title/episode in `src/utils/playbackPositions.js` and synced across devices through `continue_watching.position_seconds/duration_seconds` (every ~30s and on close; the newer of local vs synced wins, and Continue Watching links carry `&t=`); the start second is frozen per load so saving progress never changes the iframe URL. Embed iframes use `allow="autoplay *; fullscreen *; …"` — without the `*`, a player that redirects to another domain loses autoplay/fullscreen. **Before adding/removing a server, test it embedded in an iframe on a non-provider origin and watch for actual HLS/MP4 requests** — a 200 page proves nothing (vsembed.ru serves its page but shows "This media is unavailable"; vidsrc.ru is a different, working service).

### Viewing extras (Up Next, previews, alerts, history, Wrapped)

- **Up Next / binge mode** (`EmbedPlayer.js`): servers' own auto-next is disabled in their URLs; the player shows a 10s "Up Next" card in the last 30s (or on `ended` / `vidrift:nextup`) and switches episode itself so the chosen server carries over.
- **Trailers** (`src/utils/trailers.js`): hover previews (`HoverPreview.js`, 900ms hover, fine pointers only, no reduced-motion/saveData) and the `BrowseHero` billboard use muted YouTube embeds with `pointer-events: none`; they're revealed only after the YouTube JS API reports "playing" + ~2s (`whenTrailerPlaying`), otherwise YouTube's start-up chrome shows.
- **New-episode alerts:** in-app "New Episodes" row (`src/utils/newEpisodes.js`, TMDB `last_episode_to_air`) plus Web Push — `push_subscriptions`/`push_notified` tables, daily Vercel cron `GET /api/cron/new-episodes` (`server/routes/cron.js`, needs `CRON_SECRET`, `VAPID_*`, service-role key), `push`/`notificationclick` handlers in `public/sw.js`.
- **History** (`/history`): remove from history (deletes continue_watching + episode_progress) and hide from recommendations (`recommendation_hidden`, honored by `personalization.js`).
- **Previously on…** (`MediaDetailsModal.js`): Resume on a show after ≥14 days away shows the last 3 TMDB episode summaries first.
- **Book ↔ screen** (`src/utils/adaptations.js`): adaptations are identified by TMDB keyword 818 / crew job "Novel"/"Book" and matched to catalog books **by author** (titles only rank); books find adaptations via TMDB search verified by the credited author.
- **Wrapped** (`/wrapped`, math in `src/utils/wrapped.js`): yearly story slides + canvas share image. Watch time is estimated (45 min/episode, 110/movie).

### Settings, navigation & resilience (Oct 2026)

- **Profile settings** (`/settings`, `src/utils/profileSettings.js`): autoplay next, previews, data saver, haptics live in `account_profiles.settings` (jsonb) + localStorage; audio/subtitle prefs in `audio_pref`/`subtitle_pref`. `AuthContext` hydrates both from the profile row on load (row wins — it's written on every change). Never select `pin` into the client profile list.
- **Server health** (`stream_provider_health()` RPC, counts-only/security definer): `rankServers` takes `health` — a provider broadly down today (`summarizeHealth`) ranks last and is labelled; title-specific reports still win.
- **Reminders** (`watch_reminders`, `src/utils/reminders.js`, `RemindButton`, `ReminderWatcher`): delivered in-app when due, and by push via `GET /api/cron/reminders`. Vercel Hobby crons are daily, so frequent delivery needs Supabase pg_cron — `supabase/manual/schedule_reminders.sql` (fill in site URL + CRON_SECRET, run once).
- **Search** (`src/utils/searchExtras.js`): Top result → Movies → Series → Books → Live games, plus TMDB person search (actors/directors, real roles only), recent searches per profile. `/search` has its own input (phones reach it from the bottom nav).
- **Keyboard** (`components/KeyboardShortcuts.js`, mounted in `AppShell`): spatial arrow-key focus over `.st-card, .st-game, …` (scoped to the open dialog), `/` search, `?` help. Skips while an element with `data-embed-player` is mounted (the player owns the arrows).
- **Phones**: bottom nav is Home · Sports · Browse · Search · Me (Browse/Me open `BottomSheet`s; `html.has-bottom-nav` hides top search/profile). Title/book sheets close by swipe-down (`hooks/useSwipeDismiss`), have a sticky Play bar, and the player's server/audio/subtitle pickers are bottom sheets (`MobilePlaybackPickers`). Fullscreen+landscape lock only works on Android; iPhones get a "turn your phone" hint.
- **Mini-player**: desktop is a draggable corner PiP (`MiniPlayerWidget`), phones a dock; both keep saving positions from the embed's messages (`utils/playbackMessages.js`). `MiniPlayerProvider` must sit inside `BrowserRouter` (Expand navigates).
- **Errors/offline**: `ErrorBoundary` per route (`AppShell`), per `TitleRow` (`RowProblem` + Retry) and around `BrowseHero`; `OfflineBanner`. Skeletons (`.st-skel`) match real card boxes.
- **Sports second screen** (`utils/liveScores.js`, `LiveScorePanel`): ESPN site API, matched by league + `teamsMatch`; falls back to `/api/sports/espn` (allow-listed scoreboard/summary only). ESPN 403s headless browsers, so test via the proxy.
- **PWA**: manifest `shortcuts` (Continue Watching → `/home?jump=continue`, Sports, Search) and `share_target` → `/share` (`pages/ShareTarget.js`: binge./TMDB/IMDb links open the title, anything else searches).

### Ratings, franchises, calendar, teams & AI search (Oct 2026)

- **Outside ratings** (`server/routes/extras.js` `/api/extras/ratings`, `src/utils/outsideRatings.js`, `OutsideRatings`): OMDb (IMDb/RT/Metacritic) looked up server-side and cached in `title_ratings` (shared; public read). Cards only read that cache in batches (`useCachedImdb`) — never spend OMDb quota per card. Needs `OMDB_API_KEY`; falls back to TMDB score.
- **Episode heatmap** (`EpisodeHeatmap`): all seasons via one TMDB call per 20 seasons (`append_to_response=season/N`); IMDb episode ratings via `/api/extras/episodes` (cached in `episode_ratings_cache`) when OMDb is configured.
- **Hidden Gems** rows (`browseRows.js`): TMDB discover with high average + capped vote count, feature-length only.
- **Franchise order** (`utils/franchises.js`, `FranchiseOrder`): curated MCU / Star Wars / Fast & Furious (release + story order, ids verified against TMDB; MCU films sit in separate TMDB sub-collections, so curated wins); any other movie uses its TMDB collection in release order.
- **Release calendar** (`/calendar`, `utils/releaseCalendar.js`): next episodes / premieres of My List + Continue Watching shows, upcoming list movies, Coming Soon; `.ics` export (share sheet on phones, download on desktop).
- **Followed teams** (`followed_teams`, `utils/teams.js`): follow from the live score panel or Settings → "Your teams" row on Sports. Alerts (starting ≤30 min, close late, overtime, no-hitter; rules in `gameAlerts()` in `server/routes/cron.js`, deduped in `game_alerts_sent`) run inside `/api/cron/reminders` (pg_cron, every 3 min) or `/api/cron/sports`.
- **Ask binge.** (`utils/aiSearch.js`, `/api/extras/ai/picks`): Groq `openai/gpt-oss-120b` (JSON mode) suggests titles → server verifies each on TMDB (drops hallucinations, enforces runtime) → client keeps only catalog matches, with reasons. Auto-runs on request-like queries (`isConversational`), otherwise a button. Needs `GROQ_API_KEY`; rate-limited per IP and cached 1h. Horizontal scrollers added here use `HScroll` (‹ › buttons).

### CORS

`server/app.js` always allows the request's own origin (the site and API share one origin on Vercel, but browsers send `Origin` on POSTs), plus `CLIENT_URL` (comma-separated), Vercel deployment URLs and localhost. Disallowed origins just get no CORS headers (no 500).

### TV mode & the Fire TV app

- `src/utils/tvMode.js` turns on `html.tv-mode` for the TV app (`BingeTV` in the UA), TV browser UAs, or `?tv=1` (`?tv=0` off; remembered per device). `useDeviceType` reports desktop in TV mode (a 1080p TV WebView is 960×540 CSS px and would otherwise get the phone layout).
- `KeyboardShortcuts` in TV mode navigates *every* focusable control (not just cards), scopes to the open player/sheet, skips hover-only UI (`.profile-hover-drawer`), lets the player iframe take focus (the provider then gets the remote's keys), auto-focuses the first control after navigation, and exposes `window.bingeTvBack()` (out of video → close top layer → history back → `false` = leave app). Title sheets focus Play on open; the player focuses its iframe on load.
- `tv-android/` is the Android TV / Fire TV wrapper (Kotlin, single WebView activity, no dependencies): autoplay allowed, main-frame navigation locked to the binge. host (blocks ad redirects), Back routed through `bingeTvBack`. Built by `.github/workflows/tv-apk.yml` (repo variable `BINGE_URL`); sideloaded, not store-distributable.

### Apple TV app (`tv-apple/`)

Native SwiftUI tvOS app, no dependencies, hand-written `BingeTV.xcodeproj` with a folder-synced `BingeTV/` group (new files need no project edits). Same Supabase (GoTrue + PostgREST over URLSession, session in Keychain) and TMDB rows matched to the catalog by `source_key`; release window and kids filter mirror the site. Rows are scoped by `user_id` + `profile_id`, and the default (or only) profile also sees legacy rows with `profile_id` null. Home is Netflix-style (`Personal.build`: Top Picks scored across recent watches + ≥4★ ratings, "Because you watched/liked", New Episodes from TMDB `last_episode_to_air`).

**Playback is in-app** through tvOS's private **WKWebView** (`Player/WebEngine.swift`, Obj-C runtime: sideload-only, never App Store). The legacy `UIWebView` is only a fallback: any `<video>` seek crashes inside WebKit there (`canSeek = false`). The server's player page loads top-level; its `<video>` is driven by JS from the Siri remote, progress saved to `continue_watching`. tvOS has no MSE, so only native-HLS-fallback servers work: VidRift, Vidy, CineSrc (`Player/Servers.swift`). Startup is minimized by `StreamRace` (all servers at once, muted, first to play wins) and `Warmup` (one background race from the title page / focused Continue Watching card / next episode, held on its first frame; ~0.8s warm, ~2–3s cold). Don't capture stream URLs to play them natively. Video is reached through a bridge script injected into every frame (`WebEngines.bridgeScript`: reports the main `<video>` via `webkit.messageHandlers.binge`, relays commands to child frames with `postMessage`), which is what makes nested-iframe live-sports embeds controllable. **Sports** mirrors the website's page (spotlight, category chips, 16:9 thumbnail rows per league via the same `inferLeague` rules, 24/7 channels, ESPN Scores row; `SportArt` = team logos on split team colors, else provider poster, else sport icon). `Data/SportsFeed.swift` fetches PPV/Streamed/StreamFree directly (the deployed `/api/sports/streams` proxy was returning 502 'fetch failed' on 2026-10-08 while the feeds answered directly), merges per game by team nicknames, matches ESPN events the same way, and races a game's streams in the same player. **Multiview** (`Player/MultiviewView.swift`, up to 4 tiles, hold a game → Add to Multiview) gives each tile its own muted `StreamRace(keepMuted:)`; audio follows focus. QR handoff remains only as a fallback. The TV also has the site's server switches (`ServerSwitches`), 1–5★ ratings (uniform criteria), audio/subtitle prefs (`ServerPlan` uses `stream_report_summary`), outside ratings/AI picks via the site's `/api/extras/*`, heatmap, franchises, Previously on, followed teams + in-app close-game alerts (`TeamCenter`), a corner PiP + alert banner in a second non-interactive UIWindow (`Player/Overlay.swift`), History/Calendar/Wrapped, spotlight trailers, skip intro / sleep timer / Still watching, and a Top Shelf extension (`TopShelf/`, App Group `group.$(BINGE_BUNDLE_ID)`, `binge://` deep links). If Xcode has the project open while you edit `project.pbxproj` by hand, it may re-save the file and drop entries it can't resolve; re-check after editing. Keys come from `Config/Secrets.xcconfig` (gitignored; `tv-apple/scripts/make-secrets.sh` builds it from `.env`; public keys only). Build with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`; Debug launch args `-BingeDemo`, `-BingeTab`, `-BingeOpen kind:id`, `-BingePlay s:e`, `-BingePlayAfter N`, `-BingeHandoff YES`, `-BingeProbe <url>`.

### Import, monitoring, accessibility & E2E

- **History import** (`/import`, `src/utils/historyImport.js`): Letterboxd (zip/CSVs), IMDb (ratings/watchlist CSV), Trakt (JSON), Netflix (viewing-history CSV). Files are parsed in the browser (fflate for zips), detected by their columns, matched TMDB id → IMDb `/find` → title+year search → catalog, then batch-upserted (ratings via `buildUniformCategories`, half-star rounded, min 1★; list rows never downgrade existing ones). Existing binge. ratings are kept unless the user ticks "replace".
- **Error tracking (our own, no third party)**: `src/utils/monitoring.js` posts ErrorBoundary crashes + uncaught errors/rejections (production only, noise-filtered, 1/min per error) to `POST /api/ops/errors` (`server/routes/ops.js`, rate-limited) → `error_events` table. The Express error handler logs 5xx there too. Admins read/resolve them in the panel.
- **Admin panel** (`/admin`, `src/pages/AdminHome.js` + `src/pages/admin/*`): Overview (`admin_stats()` RPC — aggregates only, refuses non-admins), Servers (status, Check now → `POST /api/ops/health-check`, per-server on/off switch in `server_config` that the player honors via `fetchDisabledServers`), Errors, Announcements (`site_announcements` → `AnnouncementBanner` on every page), Notifications (`POST /api/ops/broadcast` push to all devices), Users (`AdminUsersPanel.js` — search/filter, create, promote, delete via the service-role `/api/admin/users*` routes; the old `/admin/users` page is gone and that path redirects to `/admin?tab=users`). Admin-only server actions use `adminOnly()` from `server/middleware/supabaseAdmin.js`; admin-only tables use the `public.is_admin()` RLS helper.
- **Server uptime** (`checkServers` in `server/routes/cron.js`, table `server_status`): probes each embed server (TMDB 550) every 15 min from the reminders job (or `/api/cron/health`), merges 24h viewer reports; 401/403/429 = "unknown" (bot protection, not down). Two consecutive failures → admin push + optional `ALERT_WEBHOOK_URL`. Shown on `/admin` and fed into the player's server ranking ("Down right now"). Keep `PROBES` in sync with `PROVIDERS` in EmbedPlayer.
- **Accessibility**: global `:focus-visible` ring, skip link (`AppShell`), `prefers-contrast` / `prefers-reduced-motion` handling, chip bars are `role="group"` with `aria-pressed` (not tablists), captions-first ranking (`captionsFirst` setting). axe (WCAG 2.1 AA) was clean on all main pages — keep it that way (`e2e/a11y.spec.js`).
- **E2E** (`npm run test:e2e`, Playwright, `e2e/`): sign-up (Supabase call intercepted, no account created), play/resume, rate (cleans up), TV remote flow, import, axe. Signed-in specs need `E2E_EMAIL`/`E2E_PASSWORD` for a dedicated test account; otherwise they skip.

### Network-blocked servers

Some networks (school/office firewalls) DNS-sinkhole embed hosts (seen: `embedindia.st` = all of PPV, `vsembed.su`, `embedsports.top`). `src/utils/hostReachability.js` probes hosts with a no-cors fetch; blocked servers are skipped and labelled in the movie/TV player and on Sports. Never route around the block (no VPN/DoH/proxying). Note PPV also shows "Remove sandbox attributes" to headless/automated browsers even top-level — that's not our iframe; verify PPV in a real browser. Sports **Multiview** (`?multi=id1,id2`, 2–4 games) shares `useServerRotation` with the single-game player; cross-origin player audio can't be muted by the page, so only the first tile gets autoplay permission.

### Books & manga reading

Book reading goes through `src/utils/bookAccess.js`: one Open Library search (~0.4s) decides the best *legal* edition — Standard Ebooks → Gutenberg → public Internet Archive scan → Google Books preview (server route `/api/books/google/preview`, uses `GOOGLE_BOOKS_API_KEY` when set; anonymous calls get 429s) → free IA loan → library links. Never Gutendex for lookups (measured ~28s). Standard Ebooks and Gutenberg pages are proxied by `server/routes/books.js` (`/standard/:author/:title`, `/gutenberg/read/:id`, scripts stripped) so `src/components/BookReader.js` can restyle them same-origin. In dev, `src/setupProxy.js` forwards *all* `/api` requests (CRA's `proxy` field skips `Accept: text/html`, which broke iframe page loads). Manga & Comics uses a provider registry (`src/utils/mangaProviders.js`): MangaDex (in-app reader; server proxy `/api/manga/*` first, direct client fallback; licensed chapters carry `externalUrl` to the publisher) plus WEBTOON and MANGA Plus, which come from AniList's official-source data (`src/utils/anilist.js`, `licensedById_in` 43/42) and open in the publisher's own reader (no public chapter APIs — never reverse-engineer their app APIs). Every series shows "Where to read officially" (AniList externalLinks via MangaDex's `links.al`, or an exact-title match; plus MangaDex `links.engtl`). AniList allows ~30 req/min — requests are cached and shared, and never tied to one caller's AbortSignal. Shadow libraries / scanlation aggregators (incl. Comix.to, WeebCentral, Bato) are intentionally not in the registry; `server/routes/weebcentral.js` / `bato.js` are legacy and unused by the UI.

### Sports

`src/utils/sportsProviders.js` holds the single copy of the one-entry-per-game merge (fuzzy team matching across "vs"/"at"/"@"/"-", category normalization, ±3h window, league inference). `server/routes/sports.js` only fetches + normalizes and returns `{ raw }`; the client merges. Each game's provider feeds are its selectable servers. `src/components/ChatBot.js` has its own separate, inline recommendation-card UI that reuses some of the same CSS classes as other recommendation surfaces without importing their components — check CSS class usage across files before assuming a class is scoped to one component.

### Caching & load performance

Two independent cache layers exist to cut catalog/image load times. Neither is a build concern, but both change how data freshness behaves, so know which one you're touching:

1. **Service worker (`public/sw.js`)** — cache-first for poster/cover images *regardless of origin* (they come from TMDB/Plex/Open Library/Supabase storage, all cross-origin, so the same-origin static-asset rule can't catch them), held in a separate `binge-images-v*` cache with a rough insertion-order size cap; cache-first for same-origin static assets (JS/CSS/fonts); network-first for HTML. It also does lightweight ad host/path blocking. **Any behavior change here needs a `CACHE_NAME` / `IMAGE_CACHE_NAME` version bump** so existing clients pick it up on their next load.
2. **`src/utils/sessionCache.js`** — an in-memory, per-tab (module-level `Map`) stale-while-revalidate cache for *page-level* data: the Movies/TVShows/Books catalog browse results (keyed by `buildCatalogCacheKey` over filters + sort + search + kids-mode) and the Home/Profile user-data fetches (keyed by `buildUserDataCacheKey` over namespace + userId + profileId). Callers hydrate instantly from the cache when present (skipping the spinner) then always refetch in the background and re-cache. It is deliberately not persisted (cleared on a full reload), and the bundled static fallback-catalog tier is intentionally never cached (so a transient outage's placeholder data can't get stuck).

`public/index.html` also carries `<link rel="preconnect">` hints for the Supabase host + image CDNs, and the first row of catalog/Home posters uses `loading="eager"` + `fetchPriority="high"` while everything below stays `loading="lazy"`.

### Library, ratings & watch-time stats

A rated title is treated as watched and belongs in the "Ratings & Reviews" section, **not** the watchlist/library:
- `saveSupabaseRating` (`src/utils/supabaseData.js`) deletes the matching watchlist row after saving a rating (best-effort — a delete failure must not fail the save).
- `src/utils/libraryStats.js` centralizes the dashboard math shared by Home (`ProfileStatsHeader` / `LibrarySection`) and Profile: `excludeRated` hides rated titles from the library view, `computeWatchMinutes` counts both watchlist progress and rated titles toward watch time (deduped, since rating a title you'd already tracked must not double-count), and `countCompleted` counts watched/read + rated titles. If you change what "counts" as watched or completed, do it here so both dashboards stay in sync.

### Icons

UI icons come from `@phosphor-icons/react` as SVG components, not text glyphs — a glyph like `+`/`✕` in a round button isn't reliably centered by the font, so close/add/remove buttons render `<Plus>` / `<X>` inside a flex-centered button instead.

### Environment variables

- `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` (or `_PUBLISHABLE_KEY`) — required, browser-safe.
- `REACT_APP_ENABLE_LEGACY_BACKEND` — must be `true` for any feature that falls through to the Express backend (admin account management, etc.) to work from the frontend.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — server-side only (read in `server/routes/*.js`), never prefix with `REACT_APP_`. Required for admin create/delete-account and last-login features. Not set in `vercel.json` (which only holds non-secret env values) — must be added via the Vercel project dashboard for production, and to local `.env` for `npm run server`.
- See `.env.example` for the full list, including optional scraper/import credentials and Trakt/OMDb keys used only by the data-import scripts.

## Testing notes

Test files sit next to what they test (`*.test.js`) rather than in a separate directory. The full suite is expected to be green. The catalog-page tests in `App.test.js` exercise the grid under `?view=all` (the pages themselves open on TMDB rows), and their catalog mocks return the fixture list on every call rather than predicting the probe/window/sorted-page call sequence. `src/setupTests.js` stubs `ResizeObserver` (jsdom has none) and sets a desktop-size window. `react-router-dom` v7 can't be resolved by this Jest setup: test pure logic in `src/utils/*` modules, or mock the router as `App.test.js` does.
