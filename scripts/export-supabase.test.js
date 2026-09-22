const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { quote, pgEnvironment, hashFile, parseLosslessJson } = require('./export-supabase');

test('database passwords stay out of command arguments and encoded values decode correctly', () => {
  const env = pgEnvironment('postgresql://backup:my%40pass%3Aword@localhost:5432/postgres?sslmode=verify-full');
  assert.equal(env.PGPASSWORD, 'my@pass:word');
  assert.equal(env.PGUSER, 'backup');
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.equal(quote('a"b'), '"a""b"');
});

test('exports and restores a complete local database fixture with auth IDs and large integer precision', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'binge-export-test-'));
  const pgData = path.join(root, 'postgres');
  const port = '55439';
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: 'utf8', ...options });
    assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.error || result.stdout}`);
    return result.stdout;
  };
  let started = false;
  try {
    run('initdb', ['-D', pgData, '-A', 'trust', '-U', 'export_test', '--no-locale']);
    run('pg_ctl', ['-D', pgData, '-l', path.join(root, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1 -k ${root}`, '-w', 'start']);
    started = true;
    const dbUrl = `postgresql://export_test@127.0.0.1:${port}/postgres?sslmode=disable`;
    run('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', `
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, encrypted_password text);
      INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001','fixture-hash');
      CREATE TABLE public.movies (id bigint PRIMARY KEY, title text);
      INSERT INTO public.movies VALUES (9007199254740993, 'Unicode 🍿 and newline' || chr(10) || 'title');
      CREATE TABLE public.profiles (id uuid REFERENCES auth.users, username text);
      INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-000000000001','viewer');
      CREATE TABLE storage.objects (id uuid, bucket_id text, name text, metadata jsonb);
      CREATE VIEW public.movie_genres AS SELECT 'Drama'::text AS genre;
    `]);
    const script = path.resolve(__dirname, 'export-supabase.js');
    run(process.execPath, [script], { cwd: root, env: { ...process.env, SUPABASE_DB_URL: dbUrl } });
    const dirs = await fs.readdir(path.join(root, 'backups'));
    const out = path.join(root, 'backups', dirs[0]);
    const manifest = JSON.parse(await fs.readFile(path.join(out, 'manifest.json')));
    assert.equal(manifest.complete, true);
    assert.equal(manifest.databaseSnapshotVerified, true);
    for (const table of manifest.tables) {
      assert.equal(table.status, 'verified');
      assert.equal(await hashFile(path.join(out, table.file)), table.sha256);
    }
    const movies = manifest.tables.find((t) => t.table === 'movies');
    assert.match(await fs.readFile(path.join(out, movies.file), 'utf8'), /9007199254740993/);
    run('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE restored']);
    const restoreUrl = dbUrl.replace('/postgres?', '/restored?');
    run('psql', [restoreUrl, '-v', 'ON_ERROR_STOP=1', '-c', 'DROP SCHEMA public']);
    run('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', '-d', restoreUrl, path.join(out, 'database.dump')]);
    assert.match(run('psql', [restoreUrl, '-Atc', 'SELECT id FROM public.movies']), /9007199254740993/);
    assert.match(run('psql', [restoreUrl, '-Atc', 'SELECT username FROM public.profiles']), /viewer/);
    assert.match(run('psql', [restoreUrl, '-Atc', 'SELECT genre FROM public.movie_genres']), /Drama/);
    // Missing storage access must never label a database-only backup complete.
    run('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-c', "INSERT INTO storage.objects VALUES ('00000000-0000-0000-0000-000000000002','avatars','test.png','{}')"]);
    const partialRun = spawnSync(process.execPath, [script], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, SUPABASE_DB_URL: dbUrl, SUPABASE_SERVICE_ROLE_KEY: '' },
    });
    assert.equal(partialRun.status, 1);
    const latest = (await fs.readdir(path.join(root, 'backups'))).sort().at(-1);
    const partial = JSON.parse(await fs.readFile(path.join(root, 'backups', latest, 'manifest.json')));
    assert.equal(partial.complete, false);
    assert.equal(partial.databaseSnapshotVerified, true);
    assert.equal(partial.storage.expected, 1);
    assert.equal(partial.storage.downloaded, 0);

  } finally {
    if (started) run('pg_ctl', ['-D', pgData, '-m', 'fast', '-w', 'stop']);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('REST export preserves bigint IDs for data and keyset pagination', () => {
  const text = '[{"id":1152880317676263401,"rating":8.12,"title":"Sample"}]';
  const rows = parseLosslessJson(text);
  assert.equal(rows[0].id.rawJSON, '1152880317676263401');
  assert.equal(JSON.stringify(rows), text);
});
