# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**binge.** — a media-tracking web app for movies, TV shows, and books. Users track what they watch/read, rate titles, and get personalized picks from a local taste-matching algorithm. React 19 + React Router 7 frontend, standalone PostgreSQL backend (`binge` schema) with an Express 5 API layer.

## Commands

```bash
npm start                 # runs client (CRA dev server) + Express server concurrently
npm run start:client      # CRA dev server only (port 3000, proxies /api to :5001)
npm run server            # Express server only (server/index.js, port 5001)
npm run build             # production build (react-scripts build)
npm test                  # Jest/RTL in watch mode
npm run test:standalone   # Backend PostgreSQL integration tests
npm run db:start          # Start local PostgreSQL cluster on port 55440
npm run db:stop           # Stop local PostgreSQL cluster
npm run db:status         # Check status of local PostgreSQL cluster
npm run db:init           # Initialize standalone binge schema in database
npm run sync:catalog      # Run catalog sync for movies, series, books, manga
CI=true npx react-scripts test --watchAll=false                    # run the full suite once, non-interactive
CI=true npx react-scripts test --watchAll=false src/App.test.js    # run a single test file
```

There is no separate lint script; ESLint runs as part of `react-scripts build`/`test` via the `react-app` config in `package.json`. A `CI=true` build fails on any ESLint warning (e.g. unused vars) — always do a `CI=true` build after removing code, not just a normal one.

### Data import / seeding scripts

The repo owns the pipeline that populates the catalog tables (movies/tv_shows/books) from external sources. These are standalone Node scripts:
- `npm run sync:catalog` (or `node scripts/sync-catalog.js --type movie/tv/books/manga`)
- Scrapers: `goodreads_scraper.js`, `tmdb_scraper.js`, `openlibrary_scraper.js`

## Architecture

### Standalone PostgreSQL Backend

All application data and media catalogs reside in PostgreSQL in the `binge` schema:
1. **Frontend Backend Client** (`src/utils/backendClient.js` & `src/utils/userData.js`):
   - User tracking, watchlist, ratings, and profile mutations go through `/api/backend/query` and `/api/backend/auth`.
   - Media details and catalog browsing query `binge.records`.
2. **The `api` object** (`src/api.js`):
   - Direct requests to `/api/*` (search, popular titles, provider scrapers).
3. **Storage / Assets**:
   - Avatars and user uploads are managed via `/api/backend/assets/:bucket/:name` and stored in `binge.assets`.

### Auth & profiles

Email/password authentication is managed directly by `server/standalone/auth.js` (`/api/backend/auth/*`) with bcrypt password hashing and session tokens. User profiles reside in `binge.records` (`collection='profiles'` and `collection='account_profiles'`).
`src/contexts/AuthContext.js` wraps auth-state changes and exposes `user` (with `isAdmin`/`isDev` resolved via `src/utils/userAccess.js`), `signIn`, `signUp`, `logout`, etc.

### Desktop / mobile component pairs

Several components render a completely different implementation on mobile rather than just using responsive CSS: `MediaCard.js` → `MobileMediaCard.js`, `MediaDetailsModal.js` → `MobileMediaDetail.js`, and book details have their own `MobileBookDetail.js`. The split is driven by `useIsMobile()` / `useDeviceType()` (`src/hooks/`). When changing behavior on one of these (e.g. adding/removing an action button), check whether the mobile counterpart needs the same change — they don't share implementation.

### Caching & performance

1. **Service worker (`public/sw.js`)** — cache-first for poster/cover images, held in a separate `binge-images-v*` cache with an insertion-order size cap; cache-first for same-origin static assets; network-first for HTML.
2. **`src/utils/sessionCache.js`** — an in-memory, per-tab (module-level `Map`) stale-while-revalidate cache for page-level data.

### Library, ratings & watch-time stats

A rated title is treated as watched and belongs in the "Ratings & Reviews" section, **not** the watchlist/library:
- `saveRating` (`src/utils/userData.js`) deletes the matching watchlist row after saving a rating.
- `src/utils/libraryStats.js` centralizes the dashboard math shared by Home and Profile.

### Environment variables

- `DATABASE_URL` — PostgreSQL connection string (local or hosted).
- `DATA_BACKEND=standalone` / `REACT_APP_DATA_BACKEND=standalone`.
- `REACT_APP_TMDB_API_KEY` / `TMDB_API_KEY` / `TMDB_READ_TOKEN` — for TMDB media metadata and sync.
- See `.env.example` for the full list.
