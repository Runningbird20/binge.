#!/usr/bin/env node
// Fails when Supabase is missing a table, view or function that a migration
// in supabase/migrations/ creates — i.e. a migration was never applied (the
// profile-lock migration sat unapplied until the PIN screen said "currently
// unavailable").
//
// Reads every migration in filename order, keeping track of what each one
// creates, renames and drops in the public schema, then compares that with
// what Supabase's REST API exposes (GET /rest/v1/ with the secret key: an
// OpenAPI document listing every table, view and RPC). No database URL needed.
//
//   SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/check-supabase-migrations.js
//   (SUPABASE_SERVICE_ROLE_KEY works too; reads ../.env when present)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// Only public-schema objects are exposed through the REST API.
const NAME = String.raw`(?:"?(\w+)"?\.)?"?(\w+)"?`;
const isPublic = (schema) => !schema || schema.toLowerCase() === 'public';

function expectedObjects(files) {
  const tables = new Map(); // name -> migration that created it
  const functions = new Map();
  for (const file of files) {
    const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')).toLowerCase();
    // Walk statements in order so a create followed by a drop in one file nets out.
    for (const statement of sql.split(';')) {
      let m;
      if ((m = statement.match(new RegExp(String.raw`create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${NAME}`)))) {
        if (isPublic(m[1])) tables.set(m[2], file);
      } else if ((m = statement.match(new RegExp(String.raw`create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${NAME}`)))) {
        if (isPublic(m[1])) tables.set(m[2], file);
      } else if ((m = statement.match(new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+${NAME}\s*\(`)))) {
        // Trigger functions can't be called through /rpc, so PostgREST doesn't list them.
        if (isPublic(m[1]) && !/returns\s+(?:event_)?trigger\b/.test(statement)) functions.set(m[2], file);
      } else if ((m = statement.match(new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?${NAME}\s+rename\s+to\s+"?(\w+)"?`)))) {
        if (isPublic(m[1]) && tables.has(m[2])) { tables.set(m[3], tables.get(m[2])); tables.delete(m[2]); }
      } else if ((m = statement.match(/drop\s+(?:materialized\s+)?(?:table|view)\s+(?:if\s+exists\s+)?([^;]*)/))) {
        for (const part of m[1].replace(/\b(cascade|restrict)\b/g, '').split(',')) {
          const n = part.trim().match(new RegExp(`^${NAME}`));
          if (n && isPublic(n[1])) tables.delete(n[2]);
        }
      } else if ((m = statement.match(/drop\s+function\s+(?:if\s+exists\s+)?([\s\S]*)/))) {
        // drop function a(int), b(text) — names before each argument list.
        for (const n of m[1].matchAll(new RegExp(`${NAME}\\s*(?:\\(|,|$)`, 'g'))) {
          if (isPublic(n[1])) functions.delete(n[2]);
        }
      }
    }
  }
  return { tables, functions };
}

async function exposedObjects() {
  const url = (process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  const response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  });
  if (!response.ok) throw new Error(`GET /rest/v1/ answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const paths = Object.keys((await response.json()).paths || {});
  return {
    tables: new Set(paths.filter((p) => !p.startsWith('/rpc/') && p !== '/').map((p) => p.slice(1).toLowerCase())),
    functions: new Set(paths.filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5).toLowerCase())),
  };
}

async function main() {
  loadDotEnv();
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const expected = expectedObjects(files);
  const exposed = await exposedObjects();

  const missing = [];
  for (const [name, file] of expected.tables) if (!exposed.tables.has(name)) missing.push(`table/view ${name}  (${file})`);
  for (const [name, file] of expected.functions) if (!exposed.functions.has(name)) missing.push(`function ${name}()  (${file})`);

  console.log(`Checked ${expected.tables.size} tables/views and ${expected.functions.size} functions from ${files.length} migrations.`);
  if (missing.length) {
    const byFile = [...new Set(missing.map((line) => line.match(/\(([^()]*)\)$/)[1]))];
    console.error(`\nSupabase is missing ${missing.length}:\n  ${missing.join('\n  ')}`);
    console.error(`\nApply these migrations (SQL editor, or psql "$SUPABASE_DB_URL" -f …):\n  ${byFile.join('\n  ')}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Supabase is missing migrations\n\n${missing.map((l) => `- ${l}`).join('\n')}\n`);
    }
    process.exit(1);
  }
  console.log('Supabase has everything the migrations create.');
}

main().catch((error) => { console.error(error.message); process.exit(1); });
