const { Pool } = require('pg');

let pool = null;

function isConfigured() {
  return Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED);
}

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
    if (!connectionString) {
      return null;
    }

    pool = new Pool({
      connectionString,
      max: 10,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    pool.on('error', (err) => {
      console.error('[Neon Postgres] Unexpected idle client error:', err.message);
    });
  }

  return pool;
}

async function query(text, params = []) {
  const p = getPool();
  if (!p) {
    throw new Error('Neon Postgres connection is not configured (missing DATABASE_URL).');
  }
  return p.query(text, params);
}

async function healthCheck() {
  const p = getPool();
  if (!p) {
    return {
      ok: false,
      configured: false,
      error: 'DATABASE_URL not configured',
    };
  }

  try {
    const result = await p.query(`
      SELECT 
        1 AS alive,
        NOW() AS server_time,
        current_database() AS database,
        current_user AS user,
        version() AS version
    `);

    const tableResult = await p.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY table_schema, table_name
    `);

    return {
      ok: true,
      configured: true,
      database: result.rows[0]?.database,
      user: result.rows[0]?.user,
      version: result.rows[0]?.version,
      serverTime: result.rows[0]?.server_time,
      tables: tableResult.rows.map((r) => `${r.table_schema}.${r.table_name}`),
      tableCount: tableResult.rowCount,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err.message,
    };
  }
}

async function initAppTables() {
  const p = getPool();
  if (!p) return;

  const schemaSql = `
    CREATE TABLE IF NOT EXISTS error_events (
      id SERIAL PRIMARY KEY,
      source VARCHAR(50) DEFAULT 'server',
      message TEXT NOT NULL,
      stack TEXT,
      url TEXT,
      user_agent TEXT,
      user_id VARCHAR(100),
      fingerprint VARCHAR(32),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_media (
      id SERIAL PRIMARY KEY,
      media_type VARCHAR(20) NOT NULL,
      title VARCHAR(255) NOT NULL,
      year INT,
      genre VARCHAR(100),
      poster_url TEXT,
      source_key VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_watchlist (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(100) NOT NULL,
      media_type VARCHAR(20) NOT NULL,
      media_id INT NOT NULL,
      status VARCHAR(50) DEFAULT 'plan_to_watch',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, media_type, media_id)
    );
  `;

  try {
    await p.query(schemaSql);
  } catch (err) {
    console.error('[Neon Postgres] Schema init error:', err.message);
  }
}

module.exports = {
  isConfigured,
  getPool,
  query,
  healthCheck,
  initAppTables,
};

