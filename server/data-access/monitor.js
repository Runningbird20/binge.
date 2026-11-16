// Watching the catalog (Turso) in production. Database failures and slow
// queries go to binge.'s own error log (error_events, /admin → Errors), so a
// broken catalog shows there instead of as silently empty rows on the site.
// Mistakes in the request itself (a table that isn't media, a bad filter) are
// the caller's, not the catalog's, and aren't logged.

const SLOW_MS = 2000;
// The same problem is logged at most once per 10 minutes (per server instance),
// so an outage doesn't flood the log.
const QUIET_MS = 10 * 60 * 1000;

// What server/data-access/query.js and client.js say about a bad request.
const REQUEST_MISTAKES = new Set([
  'Invalid database identifier', 'Invalid filter expression', 'Invalid null filter', 'Invalid IN filter',
  'Unsupported filter', 'Expected a single update', 'Empty update', 'Table is not accessible',
  'Invalid operation', 'Too many rows', 'Media tables are read-only through this endpoint',
  'Read-only view', 'Invalid range', 'Unsupported media function', 'Unsupported search argument',
]);

function isRequestMistake(error) {
  return error?.code === 'PGRST116' /* "Expected one row": a normal answer to .single() */
    || REQUEST_MISTAKES.has(error?.message);
}

const lastLogged = new Map();
function firstInAWhile(key, now) {
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < QUIET_MS) return false;
  if (lastLogged.size > 500) lastLogged.clear();
  lastLogged.set(key, now);
  return true;
}

// Production only: previews and local servers share the same error log.
function logToErrorLog(entry, req) {
  if (process.env.VERCEL_ENV !== 'production') {
    console.warn(`[catalog] ${entry.message} ${entry.stack}`);
    return;
  }
  require('../routes/ops').logServerError(entry, req);
}

// Runs one catalog request (`what`, e.g. "select movies") and reports it if the
// database failed or it was slow. Returns the request's result unchanged.
// `shape` (optional) says which filters and order it used, so a slow one can
// be found in the code.
async function watchCatalog(req, what, run, { log = logToErrorLog, now = Date.now, shape = '' } = {}) {
  const started = now();
  const result = await run();
  const ms = now() - started;
  const details = `${what}, ${(ms / 1000).toFixed(1)}s${shape ? `\n${shape}` : ''}`;
  if (result?.error && !isRequestMistake(result.error)) {
    const message = `Catalog error: ${result.error.message}`;
    if (firstInAWhile(message, started)) log({ message, stack: details }, req);
  } else if (ms >= SLOW_MS) {
    const message = `Slow catalog query: ${what} (over ${SLOW_MS / 1000}s)`;
    if (firstInAWhile(message, started)) log({ message, stack: details }, req);
  }
  return result;
}

// A query spec's filters and order without the values typed into them, e.g.
// "where or(overview.ilike, synopsis.ilike), source_key.not.is order vote_average desc limit 8".
function specShape(spec = {}) {
  const filter = (f) => (f.operator === 'or' || f.operator === 'and')
    ? `${f.operator}(${String(f.value).split(',').map((part) => part.split('.').slice(0, 2).join('.')).filter((v, i, all) => all.indexOf(v) === i).join(', ')})`
    : `${f.column}.${f.operator}`;
  const parts = [];
  if (spec.filters?.length) parts.push(`where ${spec.filters.map(filter).join(', ')}`.slice(0, 300));
  if (spec.orders?.length) parts.push(`order ${spec.orders.map((o) => `${o.column} ${o.ascending === false ? 'desc' : 'asc'}`).join(', ')}`);
  if (spec.limit !== undefined) parts.push(`limit ${spec.limit}`);
  if (spec.offset) parts.push(`offset ${spec.offset}`);
  if (spec.count) parts.push(`count ${spec.count}`);
  return parts.join(' ');
}

module.exports = { watchCatalog, specShape, isRequestMistake, SLOW_MS, QUIET_MS, _reset: () => lastLogged.clear() };
