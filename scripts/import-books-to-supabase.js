const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const BATCH_SIZE = 500;
const JSONL_PATH = path.join(process.cwd(), 'data', 'internet_archive_books.bulk.jsonl');

function normalizeRecord(r) {
  const title = String(r.title || '').trim();
  if (!title) return null;
  return {
    title,
    author:     String(r.author    || '').trim() || null,
    year:       r.year ? parseInt(r.year, 10) : null,
    genre:      String(r.genre     || '').trim() || null,
    synopsis:   String(r.synopsis  || r.description || '').trim().slice(0, 2000) || null,
    cover_url:  String(r.coverUrl  || r.cover_url  || '').trim() || null,
    item_url:   String(r.itemUrl   || r.item_url   || '').trim() || null,
    source_key: String(r.sourceKey || r.source_key || `internet-archive:${r.identifier || title}`).trim(),
  };
}

async function insertBatch(client, records) {
  const rows = records.map(normalizeRecord).filter(Boolean);
  if (!rows.length) return 0;

  const params = [];
  const placeholders = rows.map(row => {
    const i = params.length + 1;
    params.push(row.title, row.author, row.year, row.genre, row.synopsis, row.cover_url, row.item_url, row.source_key);
    return `($${i},$${i+1},$${i+2},$${i+3},$${i+4},$${i+5},$${i+6},$${i+7})`;
  });

  const { rowCount } = await client.query(`
    INSERT INTO public.books (title, author, year, genre, synopsis, cover_url, item_url, source_key)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (source_key) WHERE source_key IS NOT NULL
    DO UPDATE SET
      title      = excluded.title,
      author     = excluded.author,
      year       = excluded.year,
      genre      = excluded.genre,
      synopsis   = excluded.synopsis,
      cover_url  = excluded.cover_url,
      item_url   = excluded.item_url
  `, params);

  return rowCount || 0;
}

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Missing SUPABASE_DB_URL in .env');
    process.exit(1);
  }

  if (!fs.existsSync(JSONL_PATH)) {
    console.error(`Book data file not found: ${JSONL_PATH}`);
    process.exit(1);
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to Supabase.');

  let batch = [];
  let totalProcessed = 0;
  let totalUpserted  = 0;
  const start = Date.now();

  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(JSONL_PATH),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { batch.push(JSON.parse(trimmed)); } catch { continue; }

      if (batch.length >= BATCH_SIZE) {
        totalUpserted  += await insertBatch(client, batch);
        totalProcessed += batch.length;
        batch = [];
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        process.stdout.write(`\r  ${totalProcessed.toLocaleString()} processed, ${totalUpserted.toLocaleString()} upserted (${elapsed}s)`);
      }
    }

    if (batch.length) {
      totalUpserted  += await insertBatch(client, batch);
      totalProcessed += batch.length;
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nDone. ${totalProcessed.toLocaleString()} records processed, ${totalUpserted.toLocaleString()} upserted in ${elapsed}s.`);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('\nImport failed:', err.message);
  process.exitCode = 1;
});
