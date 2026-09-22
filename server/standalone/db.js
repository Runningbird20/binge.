const { Pool } = require('pg');
let pool;
function database() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL is required for the standalone backend.'), { status: 503 });
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5,
    idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, allowExitOnIdle: true,
    statement_timeout: 20000, application_name: 'binge-standalone' });
  return pool;
}
async function transaction(fn) {
  const client = await database().connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function close() { if (pool) { await pool.end(); pool = null; } }
module.exports = { database, transaction, close };
