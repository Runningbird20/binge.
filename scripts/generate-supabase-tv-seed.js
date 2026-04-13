const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_PATH = path.join(__dirname, '..', 'supabase', 'repeatable_tv_shows_seed.sql');
const INPUT_SOURCES = [
  {
    label: 'tmdb',
    prefix: 'tmdb:tv:',
    filePath: path.join(__dirname, '..', 'data', 'tmdb_tv.bulk.jsonl'),
  },
  {
    label: 'plex',
    prefix: 'plex:tv:',
    filePath: path.join(__dirname, '..', 'data', 'plex_tv.bulk.jsonl'),
  },
];

const UPSERT_COLUMNS = [
  'id',
  'title',
  'year',
  'genre',
  'creator',
  'writers',
  'cast_members',
  'age_rating',
  'overview',
  'synopsis',
  'poster_url',
  'seasons',
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

function normalizeLookupTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildShowKey(title, year) {
  return `tv_show|${normalizeLookupTitle(title)}|${year ?? 0}`;
}

function buildStableShowId(title, year) {
  const digest = crypto.createHash('sha1').update(buildShowKey(title, year)).digest('hex');
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
  let score = record.source === 'tmdb' ? 1000 : 500;
  if (record.poster_url) score += 100;
  if (record.year != null) score += 25;
  if (record.seasons != null) score += 20;
  if (record.overview && record.overview !== DESCRIPTION_FALLBACK) score += Math.min(record.overview.length, 240);
  if (record.synopsis && record.synopsis !== DESCRIPTION_FALLBACK) score += Math.min(record.synopsis.length, 240);
  if (record.genre) score += 20;
  if (record.creator) score += 10;
  if (record.cast_members) score += 10;
  return score;
}

function normalizeTvRecord(rawItem, source) {
  const title = normalizeString(rawItem?.title);
  if (!title) return null;

  const year = normalizeYear(rawItem?.year || rawItem?.releaseDate);
  const sourceKey =
    normalizeString(rawItem?.sourceKey) ||
    `${source.prefix}${slugify(title)}${year ? `-${year}` : ''}`;

  return {
    id: buildStableShowId(title, year),
    source: source.label,
    title,
    year,
    genre: normalizeString(rawItem?.genre),
    creator: normalizeString(rawItem?.creator),
    writers: normalizeString(rawItem?.writers),
    cast_members: normalizeString(rawItem?.cast_members || rawItem?.cast),
    age_rating: normalizeString(rawItem?.age_rating || rawItem?.ageRating),
    overview: normalizeString(rawItem?.overview || rawItem?.synopsis) || DESCRIPTION_FALLBACK,
    synopsis: normalizeString(rawItem?.synopsis || rawItem?.overview) || DESCRIPTION_FALLBACK,
    poster_url: normalizeString(rawItem?.poster_url || rawItem?.posterUrl),
    seasons: Number.isFinite(Number(rawItem?.seasons)) ? Number(rawItem.seasons) : null,
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

function loadTvShows() {
  const dedupedByShowKey = new Map();
  const stats = {
    loaded: {},
    dedupedCount: 0,
  };

  for (const source of INPUT_SOURCES) {
    if (!fs.existsSync(source.filePath)) {
      stats.loaded[source.label] = 0;
      continue;
    }

    const rawItems = parseJsonLines(source.filePath);
    stats.loaded[source.label] = rawItems.length;

    for (const rawItem of rawItems) {
      const record = normalizeTvRecord(rawItem, source);
      if (!record) continue;

      const showKey = buildShowKey(record.title, record.year);
      const existing = dedupedByShowKey.get(showKey);

      if (!existing || scoreRecord(record) > scoreRecord(existing)) {
        dedupedByShowKey.set(showKey, record);
      }
    }
  }

  const records = Array.from(dedupedByShowKey.values())
    .sort((left, right) => {
      const titleCompare = left.title.localeCompare(right.title);
      if (titleCompare !== 0) return titleCompare;
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
    '-- Generated by scripts/generate-supabase-tv-seed.js',
    `-- Sources: tmdb=${stats.loaded.tmdb || 0}, plex=${stats.loaded.plex || 0}, deduped=${stats.dedupedCount}`,
    '-- Run supabase/repeatable_schema.sql before this file.',
    '',
    'begin;',
    '',
    'create temp table temp_tv_shows_seed (',
    '  id bigint primary key,',
    '  title text not null,',
    '  year integer,',
    '  genre text,',
    '  creator text,',
    '  writers text,',
    '  cast_members text,',
    '  age_rating text,',
    '  overview text,',
    '  synopsis text,',
    '  poster_url text,',
    '  seasons integer,',
    '  source_key text not null',
    ') on commit drop;',
    '',
  ];

  for (const chunk of chunkItems(records, CHUNK_SIZE)) {
    lines.push(
      'insert into temp_tv_shows_seed (id, title, year, genre, creator, writers, cast_members, age_rating, overview, synopsis, poster_url, seasons, source_key)',
      'values',
      `${buildValuesSql(chunk)};`,
      ''
    );
  }

  lines.push(
    '-- Remove duplicate watchlist rows that would collapse onto the same seeded TV id.',
    'with remapped as (',
    '  select',
    '    watchlist.ctid,',
    '    watchlist.user_id,',
    '    temp_tv_shows_seed.id as next_media_id,',
    '    row_number() over (',
    "      partition by watchlist.user_id, temp_tv_shows_seed.id",
    '      order by watchlist.added_at nulls first, watchlist.id',
    '    ) as keep_rank',
    '  from public.watchlist as watchlist',
    '  join public.tv_shows as tv_shows',
    "    on watchlist.media_type = 'tv_show'",
    '   and watchlist.media_id = tv_shows.id',
    '  join temp_tv_shows_seed',
    '    on lower(trim(temp_tv_shows_seed.title)) = lower(trim(tv_shows.title))',
    '   and coalesce(temp_tv_shows_seed.year, 0) = coalesce(tv_shows.year, 0)',
    ')',
    'delete from public.watchlist as watchlist',
    'using remapped',
    'where watchlist.ctid = remapped.ctid',
    '  and remapped.keep_rank > 1;',
    '',
    '-- Remove duplicate rating rows that would collapse onto the same seeded TV id.',
    'with remapped as (',
    '  select',
    '    tv_show_ratings.ctid,',
    '    tv_show_ratings.user_id,',
    '    temp_tv_shows_seed.id as next_media_id,',
    '    row_number() over (',
    '      partition by tv_show_ratings.user_id, temp_tv_shows_seed.id',
    '      order by tv_show_ratings.created_at nulls first, tv_show_ratings.id',
    '    ) as keep_rank',
    '  from public.tv_show_ratings as tv_show_ratings',
    '  join public.tv_shows as tv_shows',
    '    on tv_show_ratings.media_id = tv_shows.id',
    '  join temp_tv_shows_seed',
    '    on lower(trim(temp_tv_shows_seed.title)) = lower(trim(tv_shows.title))',
    '   and coalesce(temp_tv_shows_seed.year, 0) = coalesce(tv_shows.year, 0)',
    ')',
    'delete from public.tv_show_ratings as tv_show_ratings',
    'using remapped',
    'where tv_show_ratings.ctid = remapped.ctid',
    '  and remapped.keep_rank > 1;',
    '',
    'update public.watchlist as watchlist',
    'set media_id = temp_tv_shows_seed.id',
    'from public.tv_shows as tv_shows',
    'join temp_tv_shows_seed',
    '  on lower(trim(temp_tv_shows_seed.title)) = lower(trim(tv_shows.title))',
    ' and coalesce(temp_tv_shows_seed.year, 0) = coalesce(tv_shows.year, 0)',
    "where watchlist.media_type = 'tv_show'",
    '  and watchlist.media_id = tv_shows.id',
    '  and watchlist.media_id <> temp_tv_shows_seed.id;',
    '',
    'update public.tv_show_ratings as tv_show_ratings',
    'set media_id = temp_tv_shows_seed.id',
    'from public.tv_shows as tv_shows',
    'join temp_tv_shows_seed',
    '  on lower(trim(temp_tv_shows_seed.title)) = lower(trim(tv_shows.title))',
    ' and coalesce(temp_tv_shows_seed.year, 0) = coalesce(tv_shows.year, 0)',
    'where tv_show_ratings.media_id = tv_shows.id',
    '  and tv_show_ratings.media_id <> temp_tv_shows_seed.id;',
    '',
    'insert into public.tv_shows (id, title, year, genre, creator, writers, cast_members, age_rating, overview, synopsis, poster_url, seasons, source_key)',
    'select id, title, year, genre, creator, writers, cast_members, age_rating, overview, synopsis, poster_url, seasons, source_key',
    'from temp_tv_shows_seed',
    'on conflict (id) do update',
    'set',
    '  title = excluded.title,',
    '  year = excluded.year,',
    '  genre = excluded.genre,',
    '  creator = excluded.creator,',
    '  writers = excluded.writers,',
    '  cast_members = excluded.cast_members,',
    '  age_rating = excluded.age_rating,',
    '  overview = excluded.overview,',
    '  synopsis = excluded.synopsis,',
    '  poster_url = excluded.poster_url,',
    '  seasons = excluded.seasons,',
    '  source_key = excluded.source_key;',
    '',
    'delete from public.tv_shows as tv_shows',
    "where (tv_shows.source_key like 'tmdb:tv:%' or tv_shows.source_key like 'plex:tv:%')",
    '  and not exists (',
    '    select 1',
    '    from temp_tv_shows_seed',
    '    where temp_tv_shows_seed.id = tv_shows.id',
    '  );',
    '',
    "select setval(pg_get_serial_sequence('public.tv_shows', 'id'), greatest(coalesce((select max(id) from public.tv_shows), 1), 1), true);",
    'analyze public.tv_shows;',
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
  const { records, stats } = loadTvShows();

  if (records.length === 0) {
    throw new Error('No TV records were found in data/tmdb_tv.bulk.jsonl or data/plex_tv.bulk.jsonl.');
  }

  const sql = buildSql(records, stats);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, sql);

  const sizeInMb = (Buffer.byteLength(sql, 'utf8') / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${records.length} deduped TV shows to ${args.output} (${sizeInMb} MB)`);
}

main();
