const { Pool, types } = require('pg');

let pool = null;

// PostgREST returns bigint and numeric as JSON numbers; pg returns strings.
// Match it so catalog ids decode the same for the web and both TV apps
// (ids stay below 2^53; anything larger is left as a string).
const toNumber = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) || (Number.isFinite(n) && !/^-?\d+$/.test(value)) ? n : value;
};
const pgTypes = {
  getTypeParser(oid, format) {
    if (oid === types.builtins.INT8 || oid === types.builtins.NUMERIC) return toNumber;
    return types.getTypeParser(oid, format);
  },
};

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
      types: pgTypes,
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

module.exports = {
  isConfigured,
  getPool,
  query,
  healthCheck,
};

