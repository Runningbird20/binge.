#!/usr/bin/env node
// Read-only export. Backups contain private account data; never serve or commit them.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ path: '.env', quiet: true });

const quote = (s) => `"${s.replace(/"/g, '""')}"`;
const digest = (s) => crypto.createHash('sha256').update(s).digest('hex');
const PUBLIC_TABLES = ['movies', 'tv_shows', 'books'];

// Postgres bigint IDs exceed JavaScript's safe integer range. Preserve the
// original JSON number token rather than rounding it during parse/stringify.
function parseLosslessJson(text) {
  return JSON.parse(text, (key, value, context) => (
    typeof value === 'number' ? JSON.rawJSON(context.source) : value
  ));
}


async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function writeJson(file, value) {
  await fsp.writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

function run(binary, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    // Do not echo stderr: drivers and database tools can include credentials.
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.resume();
    child.on('error', () => reject(new Error(`Cannot run ${path.basename(binary)}. Install PostgreSQL client tools or set PG_DUMP_BIN / PG_RESTORE_BIN.`)));
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(binary)} failed (exit ${code}); check database access and client/server versions.`)));
  });
}

async function fetchWithRetry(url, headers) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
    } catch {
      if (attempt === 3) throw new Error('Network request failed after four attempts.');
    }
    if (response?.ok) return response;
    if (response && response.status !== 429 && response.status < 500) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    await response?.body?.cancel();
    if (attempt === 3) throw new Error(`HTTP ${response?.status || 'network error'} after four attempts.`);
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
}

function apiConfig() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8')).env || {};
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || config.REACT_APP_SUPABASE_URL;
  const publicKey = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY || config.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
  if (!url || new URL(url).protocol !== 'https:') throw new Error('Set a valid HTTPS SUPABASE_URL.');
  return { url: url.replace(/\/$/, ''), publicKey };
}

async function exportPublic(out, manifest) {
  const { url, publicKey } = apiConfig();
  if (!publicKey) throw new Error('Missing public Supabase API key.');
  manifest.scope = 'public catalog only; NOT a complete backup';
  manifest.limitations = [
    'RLS can hide rows. Public API exports cannot prove all database rows were exported.',
    'No consistent snapshot across REST pages. Re-export via Postgres for migration.',
    'No private tables, auth records, live schema, or storage files included.',
  ];
  for (const table of PUBLIC_TABLES) {
    const entry = { schema: 'public', table, file: `tables/public.${table}.jsonl`, rows: 0, status: 'running' };
    manifest.tables.push(entry);
    const handle = await fsp.open(path.join(out, entry.file), 'wx', 0o600);
    try {
      let lastId;
      for (;;) {
        const params = new URLSearchParams({ select: '*', order: 'id.asc', limit: '500' });
        if (lastId !== undefined) params.set('id', `gt.${lastId}`);
        const response = await fetchWithRetry(`${url}/rest/v1/${table}?${params}`, { apikey: publicKey });
        const rows = parseLosslessJson(await response.text());
        if (!Array.isArray(rows)) throw new Error('Unexpected response shape.');
        if (!rows.length) break;
        const rawId = rows[rows.length - 1].id;
        const nextId = rawId?.rawJSON ?? rawId;
        if (nextId == null || nextId === lastId) throw new Error('Pagination did not advance.');
        await handle.write(rows.map((row) => JSON.stringify(row) + '\n').join(''));
        entry.rows += rows.length;
        lastId = nextId;
        if (entry.rows % 10000 === 0) console.log(`${table}: ${entry.rows} rows`);
      }
      entry.status = 'exported-publicly-visible-rows';
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.message;
    } finally {
      await handle.close();
    }
    entry.sha256 = await hashFile(path.join(out, entry.file));
    console.log(`${table}: ${entry.rows} rows (${entry.status})`);
    await writeJson(path.join(out, 'manifest.json'), manifest);
  }
}

function pgEnvironment(connectionString) {
  const url = new URL(connectionString);
  // Credentials travel through the child environment, never command arguments.
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCONNECT_TIMEOUT: '20',
    PGSSLMODE: url.searchParams.get('sslmode') || 'require' };
  return env;
}

async function exportDatabase(out, manifest) {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error('Set SUPABASE_DB_URL in .env.local for a complete export.');
  const pgDump = process.env.PG_DUMP_BIN || 'pg_dump';
  const pgRestore = process.env.PG_RESTORE_BIN || 'pg_restore';
  const env = pgEnvironment(connectionString);
  const client = new Client({ connectionString, connectionTimeoutMillis: 20000,
    application_name: 'binge-read-only-export' });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const server = await client.query('SHOW server_version_num');
    const version = await run(pgDump, ['--version'], env);
    const dumpMajor = Number(version.match(/PostgreSQL\) (\d+)/)?.[1]);
    const serverMajor = Math.floor(Number(server.rows[0].server_version_num) / 10000);
    if (!(dumpMajor >= serverMajor)) throw new Error(`PostgreSQL ${serverMajor}+ pg_dump required; installed version is ${dumpMajor}. Set PG_DUMP_BIN and PG_RESTORE_BIN.`);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // Fail instead of silently exporting an RLS-filtered subset.
    await client.query('SET LOCAL row_security = off');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    const schemas = (await client.query(`SELECT nspname FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname`)).rows.map((r) => r.nspname);
    manifest.databaseSchemas = schemas;
    manifest.scope = 'public, auth, storage and application schemas';
    // Preserve application schemas; platform-managed schemas are listed for review.
    const managed = new Set(['extensions', 'graphql', 'graphql_public', 'net', 'pgbouncer', 'pgsodium', 'pgsodium_masks', 'realtime', 'supabase_functions', 'supabase_migrations', 'vault', 'cron']);
    const included = schemas.filter((s) => !managed.has(s));
    manifest.excludedPlatformSchemas = schemas.filter((s) => managed.has(s));
    if (!['public', 'auth', 'storage'].every((s) => included.includes(s))) throw new Error('Expected public, auth and storage schemas are not all accessible.');
    manifest.includedSchemas = included;
    const schemaArgs = included.flatMap((s) => ['--schema', quote(s)]);
    console.log('Creating database archive from a read-only snapshot...');
    await run(pgDump, ['--format=custom', '--no-owner', '--no-privileges', '--snapshot', snapshot,
      ...schemaArgs, '--file', path.join(out, 'database.dump')], env);
    await run(pgRestore, ['--schema-only', '--no-owner', '--no-privileges', '--file', path.join(out, 'schema.sql'), path.join(out, 'database.dump')], env);
    manifest.archive = { file: 'database.dump', sha256: await hashFile(path.join(out, 'database.dump')) };
    manifest.schema = { file: 'schema.sql', sha256: await hashFile(path.join(out, 'schema.sql')) };
    const tables = (await client.query(`SELECT n.nspname AS schema, c.relname AS table
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p') AND NOT c.relispartition
      ORDER BY n.nspname, c.relname`, [included])).rows;
    if (!tables.some((t) => t.schema === 'auth' && t.table === 'users')) throw new Error('auth.users is missing; cannot preserve accounts.');
    const columns = (await client.query(`SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = ANY($1)
      ORDER BY table_schema, table_name, ordinal_position`, [included])).rows;
    await writeJson(path.join(out, 'columns.json'), columns);
    const objects = [];
    for (const table of tables) {
      const qualified = `${quote(table.schema)}.${quote(table.table)}`;
      const file = `tables/${digest(qualified)}.jsonl`;
      const entry = { ...table, file, rows: 0, status: 'running' };
      manifest.tables.push(entry);
      const count = (await client.query(`SELECT count(*)::text AS count FROM ${qualified}`)).rows[0].count;
      await client.query(`DECLARE export_rows NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS json FROM ${qualified} t`);
      const handle = await fsp.open(path.join(out, file), 'wx', 0o600);
      try {
        for (;;) {
          const { rows } = await client.query('FETCH 500 FROM export_rows');
          if (!rows.length) break;
          await handle.write(rows.map((r) => r.json + '\n').join(''));
          entry.rows += rows.length;
          if (table.schema === 'storage' && table.table === 'objects') objects.push(...rows.map((r) => JSON.parse(r.json)));
        }
      } finally { await handle.close(); }
      await client.query('CLOSE export_rows');
      if (String(entry.rows) !== count) throw new Error(`Row count mismatch for ${qualified}.`);
      entry.expectedRows = count;
      entry.sha256 = await hashFile(path.join(out, file));
      entry.status = 'verified';
      console.log(`${table.schema}.${table.table}: ${entry.rows} rows verified`);
      await writeJson(path.join(out, 'manifest.json'), manifest);
    }
    await client.query('COMMIT');
    manifest.databaseSnapshotVerified = true;
    manifest.storage = { expected: objects.length, downloaded: 0, objects: [] };
    if (objects.length) {
      const { url } = apiConfig();
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) throw new Error('Database exported; SUPABASE_SERVICE_ROLE_KEY is required to download storage objects.');
      for (const object of objects) {
        const file = `storage/${digest(`${object.bucket_id}/${object.name}`)}`;
        const objectPath = [object.bucket_id, ...object.name.split('/')].map(encodeURIComponent).join('/');
        const response = await fetchWithRetry(`${url}/storage/v1/object/authenticated/${objectPath}`, { apikey: key, Authorization: `Bearer ${key}` });
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(path.join(out, file), { flags: 'wx', mode: 0o600 }));
        const bytes = (await fsp.stat(path.join(out, file))).size;
        if (object.metadata?.size != null && bytes !== Number(object.metadata.size)) throw new Error('Storage object size changed or download is incomplete.');
        manifest.storage.objects.push({ id: object.id, bucket: object.bucket_id, name: object.name, file, bytes, sha256: await hashFile(path.join(out, file)) });
        manifest.storage.downloaded += 1;
        await writeJson(path.join(out, 'manifest.json'), manifest);
      }
    }
    // Storage is not transactional with Postgres; a final quiet-period export is needed before cutover.
    manifest.limitations = ['Storage downloads are not atomic with the database snapshot. Freeze writes for final cutover.',
      'Platform settings, OAuth/SMTP secrets, edge function deployments and Vault secrets require a separate platform inventory.',
      'Archive retains Supabase schema dependencies; restoring to plain Postgres requires adapting auth, roles and functions.'];
    manifest.complete = true;
  } finally {
    if (connected) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

async function main() {
  const publicOnly = process.argv.includes('--public-only');
  if (process.argv.some((arg, i) => i > 1 && arg !== '--public-only')) throw new Error('Usage: node scripts/export-supabase.js [--public-only]');
  process.umask(0o077);
  const out = path.resolve('backups', `supabase-${new Date().toISOString().replace(/[:.]/g, '-')}${publicOnly ? '-public' : ''}`);
  await fsp.mkdir(path.join(out, 'tables'), { recursive: true, mode: 0o700 });
  await fsp.mkdir(path.join(out, 'storage'), { mode: 0o700 });
  const manifest = { version: 1, startedAt: new Date().toISOString(), complete: false, tables: [] };
  console.log(`Export directory: ${out}`);
  try {
    if (publicOnly) await exportPublic(out, manifest);
    else await exportDatabase(out, manifest);
  } catch (error) {
    // Only expose our own errors. Database exceptions can contain private values.
    manifest.error = error.code ? `Database error (${error.code}); check access and connection settings.` : error.message;
    console.error(manifest.error);
    process.exitCode = 1;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    await writeJson(path.join(out, 'manifest.json'), manifest);
    console.log(manifest.complete ? 'Database and storage export verified.' : 'INCOMPLETE export — do not disconnect Supabase.');
    if (manifest.tables.some((t) => t.status === 'failed')) process.exitCode = 1;
  }
}

if (require.main === module) main().catch(() => { console.error('Export failed before initialization.'); process.exitCode = 1; });
module.exports = { quote, pgEnvironment, hashFile, parseLosslessJson };
