# Project 3

This project uses a React frontend and an Express API backed by SQLite.

## Setup

Install the project dependencies with:

```bash
npm install
```

The AllMovie scraper also needs a local Playwright browser binary:

```bash
npx playwright install chromium
```

Recommended runtime:

- Node.js `18+`
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

Additional runtime note:

- `playwright` requires the Chromium browser installed through `npx playwright install chromium`

## Available Scripts

### `npm start`

Starts the frontend and backend together for local development.

- Frontend: `http://localhost:3000`
- API: `http://localhost:5001`

Use this command when you want signup, login, watchlist, ratings, and other API-backed features to work in the browser.

### `npm run start:client`

Starts only the React development server on `http://localhost:3000`.

This is useful when you only need to work on frontend UI and do not need the API.

### `npm run server`

Starts only the Express API on `http://localhost:5001`.

### `npm run build`

Builds the frontend for production into the `build` folder.

### `npm test`

Runs the test suite.

## Notes

- The frontend proxies `/api/*` requests to `http://localhost:5001`.
- `better-sqlite3` is rebuilt during `postinstall` so the local native binding matches the current machine and Node version.
- The Open Library scraper uses Node's built-in `fetch`, so no separate `node-fetch` install is needed on modern Node versions.
