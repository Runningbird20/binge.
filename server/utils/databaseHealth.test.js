const test = require('node:test');
const assert = require('node:assert/strict');
const { supabaseReport, tursoReport, planFor, tursoDatabaseName, check, timed } = require('./databaseHealth');

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const SUPABASE_ENV = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'secret' };
const STATS = {
  database_bytes: 48 * MB,
  storage_bytes: 12 * MB,
  storage_files: 31,
  accounts: 22,
  tables: [{ name: 'continue_watching', bytes: 9 * MB, rows: 4210 }, { name: 'watchlist', bytes: 7 * MB, rows: 3900 }],
};

// The service-role client, as far as the report uses it.
function fakeSupabase({ countError = null, stats = STATS, statsError = null } = {}) {
  return {
    from: () => ({ select: async () => ({ count: 22, error: countError }) }),
    storage: { listBuckets: async () => ({ data: [{ id: 'avatars' }], error: null }) },
    rpc: async () => ({ data: statsError ? null : stats, error: statsError }),
  };
}

// Answers Supabase Auth's health check and Turso's Platform API; records URLs.
function fakeFetch({ tursoPlan = 'developer', usage = { rows_read: 1.2e9, rows_written: 3e6, storage_bytes: 0.5 * GB } } = {}) {
  const calls = [];
  const respond = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/auth/v1/health')) return respond({ version: 'v2.198.0', name: 'GoTrue' });
    if (url.endsWith('/usage')) return respond({ database: { uuid: 'db', instances: [], total: usage } });
    if (url.endsWith('/subscription')) return respond({ subscription: { name: tursoPlan, plan: tursoPlan, overages: false, timeline: 'monthly' } });
    return respond({}, 404);
  };
  return { fetchImpl, calls };
}

// catalogDb, as far as the report uses it.
function fakeCatalog({ configured = true, healthy = true } = {}) {
  return {
    isConfigured: () => configured,
    healthCheck: async () => (healthy ? { ok: true, configured: true, version: '3.47.0', tableCount: 35 } : { ok: false, configured: true, error: 'fetch failed' }),
    query: async (sql) => {
      if (sql.includes('pragma_page_count')) return { rows: [{ bytes: 477634560, free: 1114112 }] };
      if (sql.includes('catalog_stats')) {
        return { rows: [
          { name: 'movies.rows', value: 198481, updated_at: '2026-11-16T19:35:16.986Z' },
          { name: 'tv_shows.rows', value: 114996, updated_at: '2026-11-16T19:35:16.986Z' },
        ] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('Supabase: each service answers, and sizes are measured against the plan', async () => {
  const report = await supabaseReport(fakeSupabase(), { env: SUPABASE_ENV, fetchImpl: fakeFetch().fetchImpl });
  assert.equal(report.status, 'up');
  assert.deepEqual(report.checks.map((entry) => [entry.label, entry.status, entry.detail]), [
    ['Database', 'up', '22 accounts'],
    ['Sign-in (Auth)', 'up', 'Auth v2.198.0'],
    ['File storage', 'up', '1 bucket'],
  ]);
  assert.deepEqual(report.usage, [
    { id: 'database', label: 'Database', unit: 'bytes', used: 48 * MB, limit: 500 * MB },
    { id: 'storage', label: 'File storage', unit: 'bytes', used: 12 * MB, limit: 1 * GB, detail: '31 files' },
  ]);
  assert.deepEqual(report.tables[0], { name: 'continue_watching', bytes: 9 * MB, rows: 4210 });
  assert.deepEqual(report.plan, { id: 'free', label: 'Free', source: 'default' });
});

test('SUPABASE_PLAN=pro measures against Pro’s limits', async () => {
  const report = await supabaseReport(fakeSupabase(), { env: { ...SUPABASE_ENV, SUPABASE_PLAN: 'pro' }, fetchImpl: fakeFetch().fetchImpl });
  assert.deepEqual(report.usage.map((entry) => entry.limit), [8 * GB, 100 * GB]);
  assert.equal(report.plan.source, 'env');
});

test('before the sizes migration has run, it says what to apply, and health is still checked', async () => {
  const report = await supabaseReport(fakeSupabase({ statsError: { code: 'PGRST202', message: 'Could not find the function' } }), { env: SUPABASE_ENV, fetchImpl: fakeFetch().fetchImpl });
  assert.equal(report.status, 'up');
  assert.deepEqual(report.usage, []);
  assert.match(report.notes[0], /20261116130000_admin_database_stats\.sql/);
});

test('a service that doesn’t answer is down, with the reason', async () => {
  const report = await supabaseReport(fakeSupabase({ countError: { message: 'connection refused' } }), { env: SUPABASE_ENV, fetchImpl: fakeFetch().fetchImpl });
  assert.equal(report.status, 'down');
  assert.deepEqual([report.checks[0].status, report.checks[0].detail], ['down', 'connection refused']);
});

test('Turso: size from SQLite, the stored row counts, and a note until the Platform API is set up', async () => {
  const report = await tursoReport({ catalog: fakeCatalog(), env: { TURSO_DATABASE_URL: 'libsql://binge-catalog-me.aws-us-east-1.turso.io' }, fetchImpl: fakeFetch().fetchImpl });
  assert.equal(report.status, 'up');
  assert.equal(report.host, 'binge-catalog-me.aws-us-east-1.turso.io');
  assert.deepEqual(report.checks.map((entry) => [entry.label, entry.detail]), [['Catalog queries', 'SQLite 3.47.0 · 35 tables']]);
  assert.deepEqual(report.usage, [{ id: 'storage', label: 'Storage', unit: 'bytes', used: 477634560, limit: 5 * GB }]);
  assert.deepEqual(report.rows.map((row) => [row.name, row.rows]), [['Movies', 198481], ['Series', 114996]]);
  assert.match(report.notes[0], /TURSO_PLATFORM_TOKEN and TURSO_ORG/);
});

test('with TURSO_PLATFORM_TOKEN and TURSO_ORG: this month’s reads and writes, against the plan Turso reports', async () => {
  const { fetchImpl, calls } = fakeFetch({ tursoPlan: 'developer' });
  const env = { TURSO_DATABASE_URL: 'libsql://binge-catalog-me.aws-us-east-1.turso.io', TURSO_PLATFORM_TOKEN: 'platform', TURSO_ORG: 'me' };
  const report = await tursoReport({ catalog: fakeCatalog(), env, fetchImpl });
  assert.ok(calls.includes('https://api.turso.tech/v1/organizations/me/databases/binge-catalog/usage'));
  assert.deepEqual(report.plan, { id: 'developer', label: 'Developer', source: 'turso' });
  assert.deepEqual(report.usage, [
    { id: 'storage', label: 'Storage', unit: 'bytes', used: 0.5 * GB, limit: 9 * GB }, // what Turso bills, not the file size
    { id: 'reads', label: 'Rows read this month', unit: 'count', used: 1.2e9, limit: 2.5e9 },
    { id: 'writes', label: 'Rows written this month', unit: 'count', used: 3e6, limit: 25e6 },
  ]);
  assert.deepEqual(report.notes, []);
});

test('Turso unreachable, or not set up at all, is down and says why', async () => {
  const unreachable = await tursoReport({ catalog: fakeCatalog({ healthy: false }), env: { TURSO_DATABASE_URL: 'libsql://x-me.turso.io' }, fetchImpl: fakeFetch().fetchImpl });
  assert.deepEqual([unreachable.status, unreachable.checks[0].detail], ['down', 'fetch failed']);
  const missing = await tursoReport({ catalog: fakeCatalog({ configured: false }), env: {} });
  assert.deepEqual([missing.status, missing.checks[0].detail], ['down', 'TURSO_DATABASE_URL isn’t set on the server']);
});

test('plans, database names, slow answers and time limits', async () => {
  assert.deepEqual(planFor('turso', 'scaler'), { id: 'scaler', label: 'Scaler' }); // not listed: no limits
  assert.equal(tursoDatabaseName('binge-catalog-me.aws-us-east-1.turso.io', 'me'), 'binge-catalog');
  assert.equal(tursoDatabaseName('catalog-other.turso.io', 'me', 'catalog'), 'catalog');
  assert.equal(check('x', 'X', { ok: true, ms: 2400, value: 1 }, 'fine').status, 'slow');
  const stuck = await timed(() => new Promise(() => {}), 20);
  assert.deepEqual([stuck.ok, stuck.error], [false, 'No answer in 0.02s']);
});
