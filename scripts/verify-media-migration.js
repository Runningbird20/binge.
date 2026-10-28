// Read-only: verifies every Supabase catalog ID exists in Neon before the
// Supabase copies are dropped (watchlists, ratings and progress refer to these
// IDs). Exits 1 on any missing ID. A catalog table already removed from
// Supabase counts as done. No user data is queried.
require('dotenv').config({ path: '.env.local', quiet: true });
require('dotenv').config({ path: '.env', quiet: true });
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const TABLES = ['movies', 'tv_shows', 'books'];
const PAGE = 1000;

function isMissingTable(error) {
  return error && (error.code === 'PGRST205' || error.code === '42P01');
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const db = new Client({
    connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  const report = {};
  try {
    for (const table of TABLES) {
      const head = await sb.from(table).select('id', { head: true, count: 'exact' });
      if (isMissingTable(head.error)) {
        console.log(`${table}: already removed from Supabase`);
        report[table] = { removedFromSupabase: true };
        continue;
      }
      if (head.error) throw new Error(`${table}: ${head.error.message}`);

      const neon = await db.query(`select id::text from public.${table}`);
      const neonIds = new Set(neon.rows.map((row) => row.id));
      const missing = [];
      for (let offset = 0; offset < head.count; offset += PAGE) {
        const { data, error } = await sb.from(table).select('id,source_key').order('id').range(offset, offset + PAGE - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        for (const row of data) if (!neonIds.has(String(row.id))) missing.push(row);
      }
      report[table] = { supabase: head.count, neon: neon.rowCount, missing };
      console.log(`${table}: supabase=${head.count} neon=${neon.rowCount} missing in neon=${missing.length}`);
    }
  } finally {
    await db.end();
  }

  const out = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'binge-media-id-report.json');
  fs.writeFileSync(out, JSON.stringify(report));
  console.log(`report: ${out}`);
  if (Object.values(report).some((r) => r.missing?.length)) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
