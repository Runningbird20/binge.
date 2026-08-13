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

### Desktop / mobile component pairs

Several components render a completely different implementation on mobile rather than just using responsive CSS: `MediaCard.js` → `MobileMediaCard.js`, `MediaDetailsModal.js` → `MobileMediaDetail.js`, and book details have their own `MobileBookDetail.js`. The split is driven by `useIsMobile()` / `useDeviceType()` (`src/hooks/`). When changing behavior on one of these (e.g. adding/removing an action button), check whether the mobile counterpart needs the same change — they don't share implementation.

### Routing & lazy loading

`src/App.js` is the single route table. All page components are `React.lazy`-loaded. Routes needing auth are wrapped in `<ProtectedRoute>`; admin-only routes additionally pass `allowedUserTypes={['admin']}`.

### Recommendations

`src/utils/recommendations.js` implements the "For You" taste-matching purely client-side (or Supabase-function-side) over a user's own ratings — no external ML service. `src/components/ChatBot.js` has its own separate, inline recommendation-card UI that reuses some of the same CSS classes as other recommendation surfaces without importing their components — check CSS class usage across files before assuming a class is scoped to one component.

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

Test files sit next to what they test (`*.test.js`) rather than in a separate directory. A number of `App.test.js` cases fail out of the box in this environment independent of feature work (movies/TV/books page tests, account-settings tests) — before attributing a red test to your change, run the same test on a clean checkout to check it isn't already failing.
