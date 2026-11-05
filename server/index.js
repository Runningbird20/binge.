const app = require('./app');
const catalogDb = require('./catalogDb');

const PORT = Number(process.env.PORT) || Number(process.env.SERVER_PORT) || 5001;

// Which catalog Movies/TV/Books come from, said once at start-up, so an
// empty catalog has a visible reason (missing or wrong TURSO_* values in
// .env.local) instead of silently empty pages. Never prints the token.
function catalogLabel() {
  const url = String(process.env.TURSO_DATABASE_URL || '').trim();
  if (url.startsWith('file:')) return `local file ${url.slice(5)}`;
  try { return `Turso (${new URL(url.replace(/^libsql:/, 'https:')).host})`; } catch { return 'Turso'; }
}

async function reportCatalog() {
  const health = await catalogDb.healthCheck();
  if (health.ok) {
    console.log(`Catalog: ${catalogLabel()}, ${health.tableCount} tables`);
  } else if (!health.configured) {
    console.warn('Catalog: TURSO_DATABASE_URL isn’t set, so Movies, TV and Books will be empty. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to .env.local (see .env.example).');
  } else {
    console.warn(`Catalog: can’t reach ${catalogLabel()} (${health.error}). Movies, TV and Books won’t load until it can; check TURSO_* in .env.local.`);
  }
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  reportCatalog().catch(() => {});
});
