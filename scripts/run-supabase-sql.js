const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function resolveSqlFiles(args) {
  return args
    .map((filePath) => path.resolve(process.cwd(), filePath))
    .filter(Boolean);
}

async function runSqlFile(client, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found: ${filePath}`);
  }

  const sql = fs.readFileSync(filePath, 'utf8');
  if (!sql.trim()) {
    console.log(`[supabase-sql] Skipping empty file: ${filePath}`);
    return;
  }

  const startTime = Date.now();
  console.log(`[supabase-sql] Running ${filePath} (${formatMb(Buffer.byteLength(sql, 'utf8'))})`);
  await client.query(sql);
  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[supabase-sql] Finished ${path.basename(filePath)} in ${elapsedSeconds}s`);
}

async function main() {
  const sqlFiles = resolveSqlFiles(process.argv.slice(2));
  if (sqlFiles.length === 0) {
    throw new Error(
      'Usage: npm run supabase:sql -- <sql-file> [more-sql-files]\n' +
      'Example: npm run supabase:sql -- supabase/repeatable_schema.sql supabase/repeatable_movies_seed.sql'
    );
  }

  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Missing SUPABASE_DB_URL (or DATABASE_URL). Add your Supabase Postgres connection string to .env or .env.local.'
    );
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: 'project-3-supabase-sql-runner',
  });

  await client.connect();

  try {
    await client.query("set statement_timeout = '0'");
    await client.query("set lock_timeout = '0'");

    for (const filePath of sqlFiles) {
      await runSqlFile(client, filePath);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[supabase-sql] ${error.message}`);
  process.exitCode = 1;
});
