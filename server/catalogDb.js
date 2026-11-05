// The media catalog database: Turso (libSQL / SQLite). Accounts and user data
// stay in Supabase (docs/database-split.md).
//
//   TURSO_DATABASE_URL   libsql://<db>.turso.io, or file:path/to/catalog.db locally
//   TURSO_AUTH_TOKEN     database token (not needed for file: URLs)
//
// query(sql, params) returns { rows, rowCount, rowsAffected } like pg did, and
// accepts the Postgres flavour the routes were written in: $1-style
// placeholders and ILIKE. Rows come back shaped like the old API: JSON columns
// parsed, search_* helper columns dropped.
// Remote databases use the fetch-only client (no native SQLite binary in the
// Vercel function); file: URLs (local copies, tests) need the native one.
function createClient(config) {
  const client = config.url.startsWith('file:') ? require('@libsql/client') : require('@libsql/client/web');
  return client.createClient(config);
}

const JSON_COLUMNS = new Set(['episodes']);
const HIDDEN_COLUMN = /^search_/;

let client = null;

function databaseUrl() {
  return (process.env.TURSO_DATABASE_URL || '').trim();
}

function isConfigured() {
  return Boolean(databaseUrl());
}

function getClient() {
  if (!client) {
    const url = databaseUrl();
    if (!url) return null;
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined, intMode: 'number' });
  }
  return client;
}

// $1 -> ?1 (SQLite numbered parameters; a number may repeat) and ILIKE -> LIKE
// (SQLite's LIKE is case-insensitive for ASCII).
function translate(sql) {
  return String(sql).replace(/\$(\d+)/g, '?$1').replace(/\bILIKE\b/gi, 'LIKE');
}

function toArg(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) return JSON.stringify(value);
  return value;
}

function toRows(result, { keepSearch = false } = {}) {
  const { columns } = result;
  return result.rows.map((row) => {
    const out = {};
    columns.forEach((column, index) => {
      if (!keepSearch && HIDDEN_COLUMN.test(column)) return;
      let value = row[index];
      if (JSON_COLUMNS.has(column) && typeof value === 'string') {
        try { value = JSON.parse(value); } catch { /* keep the text */ }
      }
      out[column] = value;
    });
    return out;
  });
}

function requireClient() {
  const c = getClient();
  if (!c) throw new Error('Catalog database is not configured (missing TURSO_DATABASE_URL).');
  return c;
}

// CATALOG_DEBUG=1 logs each statement and its time; CATALOG_DEBUG=plan also
// logs SQLite's plan, flagging full-table scans (Turso bills every row scanned).
async function debugLog(statement, args, ms) {
  const mode = process.env.CATALOG_DEBUG;
  if (!mode) return;
  let plan = '';
  if (mode === 'plan' && /^\s*SELECT/i.test(statement)) {
    try {
      const r = await requireClient().execute({ sql: `EXPLAIN QUERY PLAN ${statement}`, args });
      plan = r.rows.map((row) => row.detail).join('; ');
    } catch { /* not explainable */ }
  }
  // FULL SCAN reads every row; SORT means every matching row is read and
  // sorted before LIMIT applies (no index gives that order).
  const scan = /\bSCAN (movies|tv_shows|books)\b(?! USING)/.test(plan) ? ' FULL SCAN'
    : /\b(SEARCH|SCAN) (movies|tv_shows|books)\b/.test(plan) && /TEMP B-TREE FOR ORDER BY/.test(plan) ? ' SORT' : '';
  console.log(`[catalog ${ms}ms${scan}] ${statement.replace(/\s+/g, ' ').slice(0, 2000)}${plan ? `\n    plan: ${plan}` : ''}\n    args: ${JSON.stringify(args).slice(0, 2000)}`);
}

async function query(sql, params = [], options = {}) {
  const statement = translate(sql);
  const args = params.map(toArg);
  const started = Date.now();
  const result = await requireClient().execute({ sql: statement, args });
  if (process.env.CATALOG_DEBUG) await debugLog(statement, args, Date.now() - started);
  const rows = toRows(result, options);
  return { rows, rowCount: rows.length, rowsAffected: result.rowsAffected };
}

// Several statements in one round trip, in one transaction.
async function batch(statements, mode = 'write') {
  const results = await requireClient().batch(
    statements.map(({ sql, params = [] }) => ({ sql: translate(sql), args: params.map(toArg) })),
    mode,
  );
  return results.map((result) => ({ rows: toRows(result), rowsAffected: result.rowsAffected }));
}

async function healthCheck() {
  if (!isConfigured()) return { ok: false, configured: false, error: 'TURSO_DATABASE_URL not configured' };
  try {
    const { rows } = await query("SELECT sqlite_version() AS version, (SELECT count(*) FROM sqlite_schema WHERE type = 'table') AS tables");
    return { ok: true, configured: true, version: rows[0]?.version, tableCount: rows[0]?.tables };
  } catch (err) {
    return { ok: false, configured: true, error: err.message };
  }
}

module.exports = { isConfigured, getClient, query, batch, healthCheck, translate, toArg, debugLog, JSON_COLUMNS };
