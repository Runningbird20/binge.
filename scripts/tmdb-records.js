/**
 * TMDB helpers shared by the Neon catalog scripts (sync-language-to-neon.js,
 * backfill-catalog-fields.js): a rate-limit-aware fetch and the row formatters
 * for the movies / tv_shows tables. Moved unchanged from the retired
 * sync-tmdb-to-supabase.js; the catalog lives in Neon only.
 */
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch {}

const TMDB_KEY    = process.env.TMDB_API_KEY;
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BASE   = 'https://api.themoviedb.org/3';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** TMDB API fetch with automatic retry on 429 rate-limit responses. */
async function tmdbFetch(path, params = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 429) {
    const wait = parseInt(res.headers.get('retry-after') || '10', 10);
    console.log(`\n  ⏳ Rate limited — waiting ${wait}s`);
    await sleep(wait * 1000);
    return tmdbFetch(path, params);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return res.json();
}

// ── Record formatters ─────────────────────────────────────────────────────────

function movieRecord(d) {
  if (!d?.title || d.adult === true) return null;

  const crew    = d.credits?.crew || [];
  const cast    = d.credits?.cast || [];
  const usRel   = (d.release_dates?.results || []).find(r => r.iso_3166_1 === 'US');
  const rating  = usRel?.release_dates?.find(r => r.certification)?.certification || null;
  const year    = d.release_date ? parseInt(d.release_date, 10) || null : null;

  return {
    title:             d.title,
    year,
    genre:             (d.genres || []).map(g => g.name).join(', ') || null,
    director:          crew.filter(p => p.job === 'Director').slice(0, 3).map(p => p.name).join(', ') || null,
    writers:           crew.filter(p => ['Writer','Screenplay','Story'].includes(p.job)).slice(0, 3).map(p => p.name).join(', ') || null,
    cast_members:      cast.slice(0, 8).map(p => p.name).join(', ') || null,
    age_rating:        rating,
    overview:          d.overview || null,
    synopsis:          d.overview || null,
    poster_url:        d.poster_path ? `${POSTER_BASE}${d.poster_path}` : null,
    source_key:        `tmdb:movie:${d.id}`,
    release_date:      d.release_date || null,
    imdb_id:           d.imdb_id || null,
    vote_average:      d.vote_average ?? null,
    popularity:        d.popularity ?? null,
    original_language: d.original_language || null,
  };
}

function tvRecord(d) {
  if (!d?.name || d.adult === true) return null;

  const cast   = d.credits?.cast || [];
  const rating = (d.content_ratings?.results || []).find(r => r.iso_3166_1 === 'US')?.rating || null;
  const year   = d.first_air_date ? parseInt(d.first_air_date, 10) || null : null;

  return {
    title:             d.name,
    year,
    genre:             (d.genres || []).map(g => g.name).join(', ') || null,
    creator:           (d.created_by || []).slice(0, 3).map(p => p.name).join(', ') || null,
    cast_members:      cast.slice(0, 8).map(p => p.name).join(', ') || null,
    age_rating:        rating,
    overview:          d.overview || null,
    synopsis:          d.overview || null,
    poster_url:        d.poster_path ? `${POSTER_BASE}${d.poster_path}` : null,
    seasons:           d.number_of_seasons || null,
    source_key:        `tmdb:tv:${d.id}`,
    vote_average:      d.vote_average ?? null,
    popularity:        d.popularity ?? null,
    original_language: d.original_language || null,
  };
}

module.exports = { movieRecord, tvRecord, tmdbFetch };
