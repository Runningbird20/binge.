# Project 3

This project uses a React frontend and an Express API backed by SQLite.

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
