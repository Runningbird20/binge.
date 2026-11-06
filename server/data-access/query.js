// Runs PostgREST-shaped query specs (src/utils/catalogQuery.js, the TV apps'
// GET /api/catalog/rest/:table) against the Turso catalog as SQLite SQL.
// Only MEDIA_TABLES are reachable; untrusted callers can only read.
const catalogDb = require('../catalogDb');
const { withSearchColumns } = require('../catalogSearch');
const { MEDIA_TABLES } = require('../../src/utils/mediaDatabase');

const quote = (name) => {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error('Invalid database identifier');
  return `"${name}"`;
};
const VIEWS = new Set(['movie_genres', 'tv_show_genres', 'book_genres']);
const CONFLICT_KEYS = { title_ratings: 'source_key', episode_ratings_cache: 'imdb_id,season', subtitle_cache: 'key' };
// Written by the server at any time, so their counts are never stored.
const CACHE_TABLES = new Set(Object.keys(CONFLICT_KEYS));
// Postgres sorts NULL last ascending and first descending; SQLite does the
// opposite, so orders spell it out, except on columns that are never NULL
// (an explicit NULLS clause there would stop SQLite using the index).
const NEVER_NULL = new Set(['id', 'title', 'kind', 'name', 'key']);

function splitTop(text) {
  const parts=[];let depth=0,start=0,quoted=false;
  for(let i=0;i<text.length;i++) { const c=text[i]; if(c==='"') quoted=!quoted; if(quoted)continue; if(c==='(')depth++;if(c===')')depth--;if(c===','&&depth===0){parts.push(text.slice(start,i));start=i+1;} }
  parts.push(text.slice(start));return parts.map(x=>x.trim()).filter(Boolean);
}

function filterSql(filter, values) {
  const bind = (value) => { values.push(value); return `?${values.length}`; };
  const { column, value } = filter; let op = filter.operator;
  if (op === 'or' || op === 'and') return '(' + splitTop(String(value)).map((part) => {
    const nested = part.match(/^(or|and)\((.*)\)$/s);
    if (nested) return filterSql({ operator: nested[1], value: nested[2] }, values);
    const match = part.match(/^([a-z_][a-z0-9_]*)\.(not\.)?([a-z]+)\.(.*)$/is);
    if (!match) throw new Error('Invalid filter expression');
    let raw = match[4]; const operator = (match[2] || '') + match[3];
    if (operator.endsWith('in')) raw = splitTop(raw.replace(/^\(|\)$/g, '')).map((v) => v.replace(/^"|"$/g, ''));
    return filterSql({ column: match[1], operator, value: raw }, values);
  }).join(op === 'or' ? ' OR ' : ' AND ') + ')';
  const negate = op.startsWith('not.'); if (negate) op = op.slice(4);
  const col = quote(column); let sql;
  const operators = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
  if (op === 'is') {
    if (![null, true, false, 'null', 'true', 'false'].includes(value)) throw new Error('Invalid null filter');
    // "IS NOT NULL", not "NOT (… IS NULL)": SQLite only uses the partial
    // indexes (WHERE poster_url IS NOT NULL) for the literal form.
    return `${col} IS ${negate ? 'NOT ' : ''}${String(value).toUpperCase()}`;
  } else if (op === 'in') {
    if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid IN filter');
    sql = value.length ? `${col} IN (${value.map(bind).join(',')})` : 'FALSE';
  } else if (op === 'like' || op === 'ilike') {
    // PostgREST reads * as the LIKE wildcard (e.g. `title.ilike.Dune*`).
    // SQLite's LIKE is case-insensitive (ASCII), so like and ilike match alike.
    sql = `${col} LIKE ${bind(String(value).replace(/\*/g, '%'))}`;
  } else if (operators[op]) sql = `${col} ${operators[op]} ${bind(value)}`;
  else throw new Error('Unsupported filter');
  return negate ? `NOT (${sql})` : sql;
}

function selectSql(columns = '*') {
  if (columns === '*') return '*';
  return splitTop(columns).map((col) => {
    const parts = col.split(':'); return parts.length === 2 ? `${quote(parts[1])} AS ${quote(parts[0])}` : quote(col);
  }).join(',');
}

function orderSql(o) {
  const ascending = o.ascending !== false;
  let nulls = '';
  if (o.nullsFirst !== undefined) nulls = o.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST';
  else if (!NEVER_NULL.has(o.column)) nulls = ascending ? ' NULLS LAST' : ' NULLS FIRST';
  // Titles sort case-insensitively, as under Postgres's collation (the title
  // indexes are NOCASE too).
  const collate = o.column === 'title' ? ' COLLATE NOCASE' : '';
  return `${quote(o.column)}${collate} ${ascending ? 'ASC' : 'DESC'}${nulls}`;
}

// Bounded estimate, like Postgres's planner count: the row count stored by
// scripts/turso-catalog.js refresh (a live count reads every row).
async function plannedCount(table) {
  const { rows } = await catalogDb.query('SELECT value FROM catalog_stats WHERE name = ?1', [`${table}.rows`]);
  return rows[0] ? Number(rows[0].value) : null;
}

// Exact counts read every matching row (the Books page asks for one per genre
// row), and the catalog only changes when a sync runs. So a count is stored in
// catalog_stats under a hash of its query the first time, and reused by every
// server instance until scripts/turso-catalog.js refresh clears them after the
// next sync. A short in-memory layer skips even that one-row read.
const COUNT_MEMORY_MS = 10 * 60 * 1000;
const countMemory = new Map();
async function exactCount(table, where, values) {
  const key = `count:${require('crypto').createHash('sha1').update(`${table}${where}${JSON.stringify(values)}`).digest('hex')}`;
  const hit = countMemory.get(key);
  if (hit && Date.now() - hit.at < COUNT_MEMORY_MS) return hit.value;
  const stored = (await catalogDb.query('SELECT value FROM catalog_stats WHERE name = ?1', [key])).rows[0];
  let value = stored ? Number(stored.value) : null;
  if (value === null) {
    value = Number((await catalogDb.query(`SELECT count(*) AS count FROM ${table}${where}`, values)).rows[0].count);
    await catalogDb.query('INSERT INTO catalog_stats (name, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', [key, value, new Date().toISOString()])
      .catch(() => {});
  }
  countMemory.set(key, { at: Date.now(), value });
  if (countMemory.size > 2000) countMemory.delete(countMemory.keys().next().value);
  return value;
}

function writeStatements(spec, table, rows, filters, selected) {
  const op = spec.operation;
  const returning = spec.returning ? ` RETURNING ${selected}` : '';
  if (op === 'delete') {
    const values = [];
    const where = filters.length ? ' WHERE ' + filters.map((f) => filterSql(f, values)).join(' AND ') : '';
    return [{ sql: `DELETE FROM ${table}${where}${returning}`, params: values }];
  }
  if (op === 'update') {
    if (rows.length !== 1) throw new Error('Expected a single update');
    const values = [];
    const set = Object.entries(rows[0]).map(([k, v]) => { values.push(v); return `${quote(k)}=?${values.length}`; });
    if (!set.length) throw new Error('Empty update');
    const where = filters.length ? ' WHERE ' + filters.map((f) => filterSql(f, values)).join(' AND ') : '';
    return [{ sql: `UPDATE ${table} SET ${set.join(',')}${where}${returning}`, params: values }];
  }
  // insert / upsert. SQLite has no DEFAULT in VALUES, so rows with different
  // columns go in separate statements (a missing column takes its default).
  const groups = new Map();
  for (const row of rows) {
    const cols = Object.keys(row);
    const key = cols.join(',');
    if (!groups.has(key)) groups.set(key, { cols, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(({ cols, rows: groupRows }) => {
    const values = [];
    const tuples = groupRows.map((row) => '(' + cols.map((c) => { values.push(row[c]); return `?${values.length}`; }).join(',') + ')');
    let conflict = '';
    if (op === 'upsert') {
      const keys = String(spec.onConflict || CONFLICT_KEYS[spec.table] || 'id').split(',').map((k) => k.trim());
      const set = cols.filter((c) => !keys.includes(c)).map((c) => `${quote(c)}=excluded.${quote(c)}`);
      conflict = ` ON CONFLICT (${keys.map(quote).join(',')}) ${spec.ignoreDuplicates || !set.length ? 'DO NOTHING' : 'DO UPDATE SET ' + set.join(',')}`;
    }
    return { sql: `INSERT INTO ${table} (${cols.map(quote).join(',')}) VALUES ${tuples.join(',')}${conflict}${returning}`, params: values };
  });
}

async function executeQuery(spec, { trusted = false } = {}) {
  try {
    if (!spec || !MEDIA_TABLES.has(spec.table)) throw new Error('Table is not accessible');
    const op = spec.operation || 'select'; if (!['select', 'insert', 'upsert', 'update', 'delete'].includes(op)) throw new Error('Invalid operation');
    const read = op === 'select'; const table = quote(spec.table);
    const filters = [...(spec.filters || [])];
    const rows = (spec.values === undefined ? [] : Array.isArray(spec.values) ? spec.values : [spec.values])
      .map((row) => withSearchColumns(spec.table, { ...row }));
    if (rows.length > 1000) throw new Error('Too many rows');
    if (!trusted && !read) throw new Error('Media tables are read-only through this endpoint');
    if (!read && VIEWS.has(spec.table)) throw new Error('Read-only view');
    const selected = selectSql(spec.columns);

    let resultRows;
    let count = null;
    if (read) {
      const values = [];
      const where = filters.length ? ' WHERE ' + filters.map((f) => filterSql(f, values)).join(' AND ') : '';
      const orders = (spec.orders || []).map(orderSql);
      const max = trusted ? 100000 : 1000;
      const limit = Math.min(max, Math.max(0, Number(spec.limit ?? 1000))); const offset = Math.max(0, Number(spec.offset || 0));
      if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset)) throw new Error('Invalid range');
      const sql = `SELECT ${selected} FROM ${table}${where}${orders.length ? ' ORDER BY ' + orders.join(',') : ''} LIMIT ${limit} OFFSET ${offset}`;
      if (spec.head) resultRows = [];
      else resultRows = (await catalogDb.query(sql, values)).rows;
      if (spec.count) {
        const cached = CACHE_TABLES.has(spec.table) || VIEWS.has(spec.table);
        if (spec.count !== 'exact' && !cached) count = await plannedCount(spec.table);
        if (count === null) {
          count = cached
            ? Number((await catalogDb.query(`SELECT count(*) AS count FROM ${table}${where}`, values)).rows[0].count)
            : await exactCount(table, where, values);
        }
      }
    } else {
      if (!rows.length && op !== 'delete') return { data: [], error: null };
      const results = await catalogDb.batch(writeStatements({ ...spec, operation: op }, table, rows, filters, selected));
      resultRows = results.flatMap((r) => r.rows);
    }
    let data = spec.head ? null : resultRows;
    if (spec.single || spec.maybeSingle) {
      if (resultRows.length > 1 || (spec.single && !resultRows.length)) return { data: null, error: { message: 'Expected one row', code: 'PGRST116' } };
      data = resultRows[0] || null;
    }
    return { data, error: null, count };
  } catch (error) {
    return { data: null, error: { message: error.message, code: error.code || 'CATALOG_QUERY_ERROR' } };
  }
}

module.exports = { executeQuery, filterSql, selectSql, splitTop, quote, orderSql, MEDIA_TABLES };
