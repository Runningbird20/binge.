# Project 3

This project uses a React frontend backed primarily by Supabase for auth, database access, and real-time app data.

## Setup

Install the project dependencies with:

```bash
npm install
```

Copy `.env.example` to `.env` and fill in the Supabase values before starting the app locally or deploying it.

Recommended runtime:

- Node.js `24.x`
- npm

## Dependencies

Application dependencies from `package.json`:

- `@testing-library/dom` `^10.4.1`
- `@testing-library/jest-dom` `^6.9.1`
- `@testing-library/react` `^16.3.2`
- `@testing-library/user-event` `^13.5.0`
- `bcryptjs` `^3.0.3`
- `better-sqlite3` `^12.8.0`
- `concurrently` `^9.2.1`
- `cors` `^2.8.6`
- `dotenv` `^17.4.0`
- `express` `^5.2.1`
- `jsonwebtoken` `^9.0.3`
- `playwright` `^1.59.1`
- `react` `^19.2.4`
- `react-dom` `^19.2.4`
- `react-router-dom` `^7.13.2`
- `react-scripts` `5.0.1`
- `web-vitals` `^2.1.4`

Development dependencies:

- `patch-package` `^8.0.1`

## Available Scripts

### `npm start`

Starts the frontend and the optional legacy backend together for local development.

- Frontend: `http://localhost:3000`

Use this command only when you intentionally still need the legacy Express routes while migrating older features.

### `npm run start:client`

Starts only the React development server on `http://localhost:3000`.

This is the normal local workflow for the Supabase-backed app.

### `npm run server`

Starts only the optional legacy Express API.

### `npm run import:books`

Fetches book metadata from Internet Archive and writes it to `data/internet_archive_books.json`.

### `npm run import:books:bulk`

Streams a larger Internet Archive pull into `data/internet_archive_books.bulk.jsonl` and writes a resume checkpoint file alongside it.

### `npm run import:books:resume`

Continues the bulk Internet Archive pull from the saved checkpoint.

### `npm run import:movies`

Fetches movie metadata from Plex and writes it to `data/plex_movies.json`.

### `npm run import:movies:bulk`

Streams Plex movie metadata into `data/plex_movies.bulk.jsonl` and writes a resume checkpoint file alongside it.

### `npm run import:movies:resume`

Continues the Plex movie bulk import from the saved checkpoint.

### `npm run import:movies:runner`

Runs the Plex movie importer in a resumable loop, with progress written to `data/plex_movies.runner.log`.

### `npm run import:tv`

Fetches TV metadata from Plex and writes it to `data/plex_tv.json`.

### `npm run import:tv:bulk`

Streams Plex TV metadata into `data/plex_tv.bulk.jsonl` and writes a resume checkpoint file alongside it.

### `npm run import:tv:resume`

Continues the Plex TV bulk import from the saved checkpoint.

### `npm run import:tv:runner`

Runs the Plex TV importer in a resumable loop, with progress written to `data/plex_tv.runner.log`.

### `npm run import:plex`

Fetches both movies and TV metadata from Plex.

### `npm run import:plex:bulk`

Runs the Plex bulk importer for both movies and TV.

### `npm run import:plex:resume`

Resumes the Plex bulk importer for both movies and TV.

### `npm run build`

Builds the frontend for production into the `build` folder.

### `npm test`

Runs the test suite.

## Notes

- The frontend now talks directly to Supabase for auth, forum data, watch rooms, notifications, search, and admin analytics.
- `REACT_APP_ENABLE_LEGACY_BACKEND` should stay `false` unless you intentionally still run the old Express API.
- `better-sqlite3` is rebuilt during local `postinstall` so the native binding matches the current machine and Node version. Vercel skips that rebuild for the frontend deployment.
- Vercel deployments in this repo are configured as a frontend-first Create React App build. Keep `REACT_APP_ENABLE_LEGACY_BACKEND=false` in Vercel unless you separately host and migrate the old Express backend.
- The import scripts use Node's built-in `fetch`, so no separate `node-fetch` install is needed on modern Node versions.
- The server automatically seeds from `data/plex_movies.json`, `data/plex_tv.json`, `data/plex_movies.bulk.jsonl`, `data/plex_tv.bulk.jsonl`, `data/internet_archive_books.json`, and `data/internet_archive_books.bulk.jsonl` when those files exist.
- Internet Archive imports exclude explicit/pornographic records with a keyword filter.

## Vercel Deployment

This repository is ready to deploy to Vercel as the Supabase-backed frontend.

Required Vercel environment variables:

- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`
- `REACT_APP_ENABLE_LEGACY_BACKEND=false`

Optional only if you separately host the legacy backend:

- `REACT_APP_LEGACY_API_URL`

Notes:

- `vercel.json` includes an SPA fallback so client-side routes like `/movies`, `/books`, and `/watchlist` load correctly on refresh.
- The linked Vercel project should use Node `24.x` to match `package.json`.
- `supabase/repeatable_schema.sql` is the rerunnable schema sync file for the current Supabase-backed frontend. Edit that file when you need additive schema updates you want to rerun in the Supabase SQL editor.
- Legacy Express + SQLite features such as `Lists`, `Live TV`, chat-backed recommendations, and admin request workflows are not part of the Vercel frontend deployment yet. Those screens stay hidden or show the legacy notice unless you intentionally wire up that older backend elsewhere.

## Internet Archive Books

The Internet Archive scraper exports the book fields this app uses:

- `coverUrl`
- `title`
- `author`
- `genre`
- `year`
- `description`

Examples:

```bash
node internet_archive_scraper.js --limit 25
node internet_archive_scraper.js --query "mediatype:texts AND subject:(science fiction)" --limit 10
```

Notes:

- `--query` uses Internet Archive advanced search syntax.
- Per-item metadata requests fill in better descriptions and dates by default.
- Explicit/pornographic records are filtered out before export.
- Bulk mode is available through `--all` or `npm run import:books:bulk`.
- Bulk exports write newline-delimited JSON and a checkpoint file so the crawl can be resumed.
- Resume a previous batch with `npm run import:books:resume`.

## Plex Movies And TV

Plex imports scrape the public Plex movie and TV database pages and normalize them into the app's movie and TV schema.

Examples:

```bash
node plex_importer.js --type movie --limit 20
node plex_importer.js --type tv --limit 10
node plex_importer.js --type both --limit 15
node plex_importer.js --type movie --all --max-items 100
node plex_importer.js --type tv --all --resume --max-items 100
```

Notes:

- Bulk mode writes newline-delimited JSON and a checkpoint file, just like the Internet Archive importer.
- Movies are grouped by year on Plex, and TV shows are grouped by decade.
- Bulk checkpoints track both the current catalog page and the current title index within that page.
- Use `node plex_resume_runner.js --type movie` or `node plex_resume_runner.js --type tv` for a background runner.
- The runner writes progress logs to `data/plex_movies.runner.log` and `data/plex_tv.runner.log`.
- Imported Plex records now include `title`, `overview`, `writers`, `cast`, and `age rating` in addition to the existing normalized fields.
- The importer writes normalized JSON and JSONL that the server seeds into the `movies` and `tv_shows` tables.
