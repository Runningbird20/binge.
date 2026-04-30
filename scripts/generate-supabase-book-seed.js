const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_PATH = path.join(__dirname, '..', 'supabase', 'repeatable_books_seed.sql');
const GOODREADS_INPUT_PATH = path.join(__dirname, '..', 'data', 'goodreads_books.bulk.jsonl');
const PRIMARY_INPUT_PATH = path.join(__dirname, '..', 'data', 'internet_archive_books.bulk.jsonl');
const FALLBACK_INPUT_PATH = path.join(__dirname, '..', 'data', 'internet_archive_books.json');

const UPSERT_COLUMNS = [
  'id',
  'title',
  'author',
  'year',
  'genre',
  'synopsis',
  'cover_url',
  'item_url',
  'source_key',
];

const DESCRIPTION_FALLBACK = 'No description available yet.';
const CHUNK_SIZE = 400;

function normalizeString(value) {
  if (value == null) return null;
  const normalized = String(value)
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeYear(value) {
  if (value == null || value === '') return null;
  const match = String(value).match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}

function normalizeLookupValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildBookKey(sourceKey, title, author, year) {
  return sourceKey || `book|${normalizeLookupValue(title)}|${normalizeLookupValue(author)}|${year ?? 0}`;
}

function buildStableBookId(sourceKey, title, author, year) {
  const digest = crypto.createHash('sha1').update(buildBookKey(sourceKey, title, author, year)).digest('hex');
  return BigInt(`0x${digest.slice(0, 15)}`).toString();
}

function escapeSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function toSqlValue(value) {
  if (value == null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  return escapeSqlString(value);
}

function chunkItems(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function scoreRecord(record) {
  let score = 1000;
  if (record.cover_url) score += 100;
  if (record.item_url) score += 75;
  if (record.year != null) score += 25;
  if (record.synopsis && record.synopsis !== DESCRIPTION_FALLBACK) score += Math.min(record.synopsis.length, 300);
  if (record.genre) score += 20;
  if (record.author) score += 10;
  return score;
}

function normalizeBookRecord(rawItem) {
  const title = normalizeString(rawItem?.title);
  if (!title) return null;

  const author = normalizeString(rawItem?.author);
  const year = normalizeYear(rawItem?.year);
  const sourceKey =
    normalizeString(rawItem?.sourceKey) ||
    normalizeString(rawItem?.source_key) ||
    (normalizeString(rawItem?.identifier) ? `internet-archive:${normalizeString(rawItem.identifier)}` : null) ||
    buildBookKey(null, title, author, year);

  return {
    id: buildStableBookId(sourceKey, title, author, year),
    title,
    author,
    year,
    genre: normalizeString(rawItem?.genre) || 'General Interest',
    synopsis: normalizeString(rawItem?.synopsis || rawItem?.description) || DESCRIPTION_FALLBACK,
    cover_url: normalizeString(rawItem?.coverUrl || rawItem?.cover_url),
    item_url: normalizeString(rawItem?.itemUrl || rawItem?.item_url),
    source_key: sourceKey,
  };
}

function parseJsonLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseFallbackJson(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(parsed?.books)) return parsed.books;
  if (Array.isArray(parsed?.items)) return parsed.items;
  return [];
}

function loadBooks() {
  const dedupedByBookKey = new Map();
  const stats = {
    loaded: 0,
    dedupedCount: 0,
    sourceFile: null,
  };

  let rawItems = [];
  if (fs.existsSync(GOODREADS_INPUT_PATH)) {
    rawItems = parseJsonLines(GOODREADS_INPUT_PATH);
    stats.sourceFile = GOODREADS_INPUT_PATH;
  } else if (fs.existsSync(PRIMARY_INPUT_PATH)) {
    rawItems = parseJsonLines(PRIMARY_INPUT_PATH);
    stats.sourceFile = PRIMARY_INPUT_PATH;
  } else if (fs.existsSync(FALLBACK_INPUT_PATH)) {
    rawItems = parseFallbackJson(FALLBACK_INPUT_PATH);
    stats.sourceFile = FALLBACK_INPUT_PATH;
  }

  stats.loaded = rawItems.length;

  for (const rawItem of rawItems) {
    const record = normalizeBookRecord(rawItem);
    if (!record) continue;

    const bookKey = buildBookKey(record.source_key, record.title, record.author, record.year);
    const existing = dedupedByBookKey.get(bookKey);

    if (!existing || scoreRecord(record) > scoreRecord(existing)) {
      dedupedByBookKey.set(bookKey, record);
    }
  }

  const records = Array.from(dedupedByBookKey.values())
    .sort((left, right) => {
      const titleCompare = left.title.localeCompare(right.title);
      if (titleCompare !== 0) return titleCompare;
      const authorCompare = String(left.author || '').localeCompare(String(right.author || ''));
      if (authorCompare !== 0) return authorCompare;
      if ((left.year ?? 0) !== (right.year ?? 0)) return (left.year ?? 0) - (right.year ?? 0);
      return left.source_key.localeCompare(right.source_key);
    });

  stats.dedupedCount = records.length;
  return { records, stats };
}

function buildValuesSql(records) {
  return records.map((record) => `  (${UPSERT_COLUMNS.map((column) => toSqlValue(record[column])).join(', ')})`).join(',\n');
}

function buildSql(records, stats) {
  const lines = [
    '-- Generated by scripts/generate-supabase-book-seed.js',
    `-- Source file: ${stats.sourceFile || 'none'}; loaded=${stats.loaded}, deduped=${stats.dedupedCount}`,
    '-- Run supabase/repeatable_schema.sql before this file.',
    '',
    'begin;',
    '',
    'create temp table temp_books_seed (',
    '  id bigint primary key,',
    '  title text not null,',
    '  author text,',
    '  year integer,',
    '  genre text,',
    '  synopsis text,',
    '  cover_url text,',
    '  item_url text,',
    '  source_key text not null',
    ') on commit drop;',
    '',
  ];

  for (const chunk of chunkItems(records, CHUNK_SIZE)) {
    lines.push(
      'insert into temp_books_seed (id, title, author, year, genre, synopsis, cover_url, item_url, source_key)',
      'values',
      `${buildValuesSql(chunk)};`,
      ''
    );
  }

  lines.push(
    '-- Remove duplicate watchlist rows that would collapse onto the same seeded book id.',
    'with remapped as (',
    '  select',
    '    watchlist.ctid,',
    '    watchlist.user_id,',
    '    temp_books_seed.id as next_media_id,',
    '    row_number() over (',
    "      partition by watchlist.user_id, temp_books_seed.id",
    '      order by watchlist.added_at nulls first, watchlist.id',
    '    ) as keep_rank',
    '  from public.watchlist as watchlist',
    '  join public.books as books',
    "    on watchlist.media_type = 'book'",
    '   and watchlist.media_id = books.id',
    '  join temp_books_seed',
    '    on temp_books_seed.source_key = books.source_key',
    '    or (',
    '      lower(trim(temp_books_seed.title)) = lower(trim(books.title))',
    "      and coalesce(lower(trim(temp_books_seed.author)), '') = coalesce(lower(trim(books.author)), '')",
    '      and coalesce(temp_books_seed.year, 0) = coalesce(books.year, 0)',
    '    )',
    ')',
    'delete from public.watchlist as watchlist',
    'using remapped',
    'where watchlist.ctid = remapped.ctid',
    '  and remapped.keep_rank > 1;',
    '',
    '-- Remove duplicate rating rows that would collapse onto the same seeded book id.',
    'with remapped as (',
    '  select',
    '    book_ratings.ctid,',
    '    book_ratings.user_id,',
    '    temp_books_seed.id as next_media_id,',
    '    row_number() over (',
    '      partition by book_ratings.user_id, temp_books_seed.id',
    '      order by book_ratings.created_at nulls first, book_ratings.id',
    '    ) as keep_rank',
    '  from public.book_ratings as book_ratings',
    '  join public.books as books',
    '    on book_ratings.media_id = books.id',
    '  join temp_books_seed',
    '    on temp_books_seed.source_key = books.source_key',
    '    or (',
    '      lower(trim(temp_books_seed.title)) = lower(trim(books.title))',
    "      and coalesce(lower(trim(temp_books_seed.author)), '') = coalesce(lower(trim(books.author)), '')",
    '      and coalesce(temp_books_seed.year, 0) = coalesce(books.year, 0)',
    '    )',
    ')',
    'delete from public.book_ratings as book_ratings',
    'using remapped',
    'where book_ratings.ctid = remapped.ctid',
    '  and remapped.keep_rank > 1;',
    '',
    'update public.watchlist as watchlist',
    'set media_id = temp_books_seed.id',
    'from public.books as books',
    'join temp_books_seed',
    '  on temp_books_seed.source_key = books.source_key',
    '  or (',
    '    lower(trim(temp_books_seed.title)) = lower(trim(books.title))',
    "    and coalesce(lower(trim(temp_books_seed.author)), '') = coalesce(lower(trim(books.author)), '')",
    '    and coalesce(temp_books_seed.year, 0) = coalesce(books.year, 0)',
    '  )',
    "where watchlist.media_type = 'book'",
    '  and watchlist.media_id = books.id',
    '  and watchlist.media_id <> temp_books_seed.id;',
    '',
    'update public.book_ratings as book_ratings',
    'set media_id = temp_books_seed.id',
    'from public.books as books',
    'join temp_books_seed',
    '  on temp_books_seed.source_key = books.source_key',
    '  or (',
    '    lower(trim(temp_books_seed.title)) = lower(trim(books.title))',
    "    and coalesce(lower(trim(temp_books_seed.author)), '') = coalesce(lower(trim(books.author)), '')",
    '    and coalesce(temp_books_seed.year, 0) = coalesce(books.year, 0)',
    '  )',
    'where book_ratings.media_id = books.id',
    '  and book_ratings.media_id <> temp_books_seed.id;',
    '',
    'insert into public.books (id, title, author, year, genre, synopsis, cover_url, item_url, source_key)',
    'select id, title, author, year, genre, synopsis, cover_url, item_url, source_key',
    'from temp_books_seed',
    'on conflict (id) do update',
    'set',
    '  title = excluded.title,',
    '  author = excluded.author,',
    '  year = excluded.year,',
    '  genre = excluded.genre,',
    '  synopsis = excluded.synopsis,',
    '  cover_url = excluded.cover_url,',
    '  item_url = excluded.item_url,',
    '  source_key = excluded.source_key;',
    '',
    'delete from public.books as books',
    'where not exists (',
    '  select 1',
    '  from temp_books_seed',
    '  where temp_books_seed.id = books.id',
    ');',
    '',
    "select setval(pg_get_serial_sequence('public.books', 'id'), greatest(coalesce((select max(id) from public.books), 1), 1), true);",
    'analyze public.books;',
    '',
    'commit;',
    ''
  );

  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT_PATH };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output' && argv[index + 1]) {
      args.output = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { records, stats } = loadBooks();

  if (records.length === 0) {
    throw new Error('No book records were found in data/goodreads_books.bulk.jsonl, data/internet_archive_books.bulk.jsonl, or data/internet_archive_books.json.');
  }

  const sql = buildSql(records, stats);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, sql);

  const sizeInMb = (Buffer.byteLength(sql, 'utf8') / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${records.length} books to ${args.output} (${sizeInMb} MB)`);
}

main();
