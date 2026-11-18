// Admin → Databases: the health of both databases and how full they are.
//
// Supabase (accounts and everything people save), through the service role:
// a query, Auth's health endpoint, Storage, and sizes from
// admin_database_stats() (migration 20261116130000).
//
// Turso (the media catalog), through catalogDb: a query, the database's size
// (PRAGMA page_count × page_size; no rows read), the row counts the catalog
// keeps (catalog_stats), and, when TURSO_PLATFORM_TOKEN and TURSO_ORG are set,
// this month's rows read and written from Turso's Platform API (what it bills).
//
// Plan limits: the plan Turso's API reports, else TURSO_PLAN; SUPABASE_PLAN.
// Both default to the free plan.
const catalogDb = require('../catalogDb');

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const SLOW_MS = 1500;
const TIMEOUT_MS = 8000;

// supabase.com/pricing and turso.tech/pricing, November 2026.
const PLANS = {
  supabase: {
    free: { label: 'Free', database: 500 * MB, storage: 1 * GB },
    pro: { label: 'Pro', database: 8 * GB, storage: 100 * GB },
  },
  turso: {
    free: { label: 'Free', storage: 5 * GB, rowsRead: 500e6, rowsWritten: 10e6 },
    developer: { label: 'Developer', storage: 9 * GB, rowsRead: 2.5e9, rowsWritten: 25e6 },
  },
};

// A plan's limits; a plan not listed above keeps its name but has none.
function planFor(service, name) {
  const id = String(name || 'free').trim().toLowerCase();
  const known = PLANS[service][id];
  return known ? { id, ...known } : { id, label: id.charAt(0).toUpperCase() + id.slice(1) };
}

// Runs one check with a time limit: { ok, ms, value } or { ok: false, ms, error, code }.
async function timed(task, timeoutMs = TIMEOUT_MS) {
  const started = Date.now();
  let timer;
  try {
    const value = await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`No answer in ${timeoutMs / 1000}s`)), timeoutMs); }),
    ]);
    return { ok: true, ms: Date.now() - started, value };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: error?.message || String(error), code: error?.code };
  } finally {
    clearTimeout(timer);
  }
}

function check(id, label, result, detail) {
  return {
    id,
    label,
    status: !result.ok ? 'down' : result.ms > SLOW_MS ? 'slow' : 'up',
    ms: result.ms,
    detail: result.ok ? detail : result.error,
  };
}

const RANK = { up: 0, slow: 1, down: 2 };
function overall(checks) {
  return checks.reduce((worst, entry) => (RANK[entry.status] > RANK[worst] ? entry.status : worst), 'up');
}

function plural(count, word) {
  if (count == null) return '';
  return `${Number(count).toLocaleString('en-US')} ${word}${Number(count) === 1 ? '' : 's'}`;
}

function failWith(error) {
  throw Object.assign(new Error(error.message || String(error)), { code: error.code });
}

async function supabaseReport(db, { env = process.env, fetchImpl = fetch } = {}) {
  const url = env.SUPABASE_URL || env.REACT_APP_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const plan = planFor('supabase', env.SUPABASE_PLAN);
  const [query, auth, storage, sizes] = await Promise.all([
    timed(async () => {
      const { count, error } = await db.from('profiles').select('id', { count: 'exact', head: true });
      if (error) failWith(error);
      return count;
    }),
    timed(async () => {
      const response = await fetchImpl(`${url}/auth/v1/health`, { headers: { apikey: key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json().catch(() => ({}));
    }),
    timed(async () => {
      const { data, error } = await db.storage.listBuckets();
      if (error) failWith(error);
      return data || [];
    }),
    timed(async () => {
      const { data, error } = await db.rpc('admin_database_stats');
      if (error) failWith(error);
      return data;
    }),
  ]);

  const checks = [
    check('database', 'Database', query, plural(query.value, 'account')),
    check('auth', 'Sign-in (Auth)', auth, auth.value?.version ? `Auth ${auth.value.version}` : 'Answering'),
    check('storage', 'File storage', storage, plural(storage.value?.length, 'bucket')),
  ];
  const stats = sizes.ok ? sizes.value : null;
  const notes = [];
  if (!sizes.ok) {
    notes.push(sizes.code === 'PGRST202'
      ? 'Sizes show up once supabase/migrations/20261116130000_admin_database_stats.sql has been applied.'
      : `Sizes couldn’t be read: ${sizes.error}`);
  }
  const usage = stats ? [
    { id: 'database', label: 'Database', unit: 'bytes', used: Number(stats.database_bytes) || 0, limit: plan.database ?? null },
    { id: 'storage', label: 'File storage', unit: 'bytes', used: Number(stats.storage_bytes) || 0, limit: plan.storage ?? null, detail: plural(stats.storage_files, 'file') },
  ] : [];
  return {
    status: overall(checks),
    plan: { id: plan.id, label: plan.label, source: env.SUPABASE_PLAN ? 'env' : 'default' },
    checks,
    usage,
    tables: (stats?.tables || []).map((table) => ({ name: table.name, bytes: Number(table.bytes) || 0, rows: Number(table.rows) || 0 })),
    notes,
  };
}

function tursoHost(env) {
  try {
    return new URL(String(env.TURSO_DATABASE_URL || '').trim()).hostname || null;
  } catch {
    return null;
  }
}

// The database's name for Turso's Platform API. Its hostname is
// <database>-<organization>.<region>.turso.io; TURSO_DATABASE_NAME overrides.
function tursoDatabaseName(host, org, explicit) {
  if (explicit) return explicit;
  const label = String(host || '').split('.')[0];
  const suffix = `-${org}`;
  return org && label.endsWith(suffix) ? label.slice(0, -suffix.length) : label || null;
}

async function tursoPlatform({ env, fetchImpl, host }) {
  const base = `https://api.turso.tech/v1/organizations/${encodeURIComponent(env.TURSO_ORG)}`;
  const options = { headers: { Authorization: `Bearer ${env.TURSO_PLATFORM_TOKEN}` }, signal: AbortSignal.timeout(TIMEOUT_MS) };
  const name = tursoDatabaseName(host, env.TURSO_ORG, env.TURSO_DATABASE_NAME);
  const [usage, subscription] = await Promise.all([
    fetchImpl(`${base}/databases/${encodeURIComponent(name)}/usage`, options).then(async (response) => {
      if (!response.ok) throw new Error(`Turso’s API answered HTTP ${response.status}`);
      return response.json();
    }),
    fetchImpl(`${base}/subscription`, options).then((response) => (response.ok ? response.json() : null)).catch(() => null),
  ]);
  const total = usage?.database?.total || usage?.database?.usage || {};
  return {
    plan: subscription?.subscription?.plan || subscription?.subscription?.name || null,
    rowsRead: Number(total.rows_read) || 0,
    rowsWritten: Number(total.rows_written) || 0,
    storageBytes: Number(total.storage_bytes) || null,
  };
}

const CATALOG_ROWS = { 'movies.rows': 'Movies', 'tv_shows.rows': 'Series' };

async function tursoReport({ catalog = catalogDb, env = process.env, fetchImpl = fetch } = {}) {
  const host = tursoHost(env);
  const platformSet = Boolean(env.TURSO_PLATFORM_TOKEN && env.TURSO_ORG);
  if (!catalog.isConfigured()) {
    const plan = planFor('turso', env.TURSO_PLAN);
    return {
      status: 'down',
      host: null,
      plan: { id: plan.id, label: plan.label, source: env.TURSO_PLAN ? 'env' : 'default' },
      checks: [{ id: 'query', label: 'Catalog queries', status: 'down', ms: null, detail: 'TURSO_DATABASE_URL isn’t set on the server' }],
      usage: [],
      rows: [],
      notes: [],
    };
  }

  const [health, size, counts, platform] = await Promise.all([
    timed(async () => {
      const result = await catalog.healthCheck();
      if (!result.ok) throw new Error(result.error);
      return result;
    }),
    timed(async () => (await catalog.query('SELECT page_count * page_size AS bytes, freelist_count * page_size AS free FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count()')).rows[0]),
    timed(async () => (await catalog.query("SELECT name, value, updated_at FROM catalog_stats WHERE name IN ('movies.rows', 'tv_shows.rows')")).rows),
    platformSet ? timed(() => tursoPlatform({ env, fetchImpl, host })) : Promise.resolve(null),
  ]);

  const checks = [check('query', 'Catalog queries', health, health.ok ? `SQLite ${health.value.version} · ${plural(health.value.tableCount, 'table')}` : '')];
  if (platform) checks.push(check('platform', 'Usage reports (Turso API)', platform, 'Answering'));

  const billed = platform?.ok ? platform.value : null;
  const plan = planFor('turso', billed?.plan || env.TURSO_PLAN);
  const usage = [];
  const storageBytes = billed?.storageBytes ?? (size.ok && size.value ? Number(size.value.bytes) : null);
  if (storageBytes != null) usage.push({ id: 'storage', label: 'Storage', unit: 'bytes', used: storageBytes, limit: plan.storage ?? null });
  if (billed) {
    usage.push({ id: 'reads', label: 'Rows read this month', unit: 'count', used: billed.rowsRead, limit: plan.rowsRead ?? null });
    usage.push({ id: 'writes', label: 'Rows written this month', unit: 'count', used: billed.rowsWritten, limit: plan.rowsWritten ?? null });
  }

  const notes = [];
  if (!platformSet) notes.push('Rows read and written this month (what Turso bills) show up once TURSO_PLATFORM_TOKEN and TURSO_ORG are set on the server.');
  if (!size.ok) notes.push(`Size couldn’t be read: ${size.error}`);

  const rows = counts.ok
    ? Object.entries(CATALOG_ROWS).map(([name, label]) => {
      const row = (counts.value || []).find((entry) => entry.name === name);
      return row ? { name: label, rows: Number(row.value) || 0, updatedAt: row.updated_at || null } : null;
    }).filter(Boolean)
    : [];

  return {
    status: overall(checks),
    host,
    plan: { id: plan.id, label: plan.label, source: billed?.plan ? 'turso' : env.TURSO_PLAN ? 'env' : 'default' },
    checks,
    usage,
    rows,
    notes,
  };
}

async function databaseReport({ supabase, catalog, env, fetchImpl, now = Date.now() } = {}) {
  const [supabaseHealth, tursoHealth] = await Promise.all([
    supabaseReport(supabase, { env, fetchImpl }),
    tursoReport({ catalog, env, fetchImpl }),
  ]);
  return { checkedAt: new Date(now).toISOString(), supabase: supabaseHealth, turso: tursoHealth };
}

module.exports = { databaseReport, supabaseReport, tursoReport, planFor, tursoDatabaseName, check, timed, PLANS };
