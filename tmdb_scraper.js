#!/usr/bin/env node
/**
 * tmdb_scraper.js — Imports movies and TV shows from TMDB.
 * - Filters out ALL adult content (include_adult=false, certification filters, genre exclusions)
 * - Covers popular lists + every genre + decade-based discovery + languages
 *
 * Usage:
 *   node tmdb_scraper.js --type both --pages 20
 *   node tmdb_scraper.js --type both --pages 50 --resume
 *   node tmdb_scraper.js --type both --pages 500  # maximum possible
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE    = 'https://api.themoviedb.org/3';
const POSTER_BASE  = 'https://image.tmdb.org/t/p/w500';
const DATA_DIR     = path.join(__dirname, 'data');

const args     = process.argv.slice(2);
const getArg   = (name, fallback) => { const i = args.indexOf(name); return i !== -1 && args[i+1] ? args[i+1] : fallback; };
const hasFlag  = (f) => args.includes(f);

const TYPE     = getArg('--type', 'both');
const PAGES    = parseInt(getArg('--pages', '20'), 10);
const DELAY_MS = parseInt(getArg('--delay', '260'), 10);
const RESUME   = hasFlag('--resume');

// ── Adult content exclusion ───────────────────────────────────────────────────
// TMDB genre IDs to EXCLUDE from all results
const EXCLUDED_MOVIE_GENRES = []; // TMDB doesn't have an explicit adult genre in standard list
const EXCLUDED_TV_GENRES    = []; // We use include_adult=false + certification filters instead

// Keywords that indicate adult content — filter at record level
// Minimum vote count — filters out spam/fake/low-quality uploads
const MIN_VOTES_POPULAR  = 50;
const MIN_VOTES_DISCOVER = 10;

// Precise adult content detection — avoids false positives
const BLOCKED_EXACT_TITLES = new Set([
  'overflow', 'eromanga sensei', 'eromanga-sensei', 'yosuga no sora',
  'kiss x sis', 'redo of healer', 'kaifuku jutsushi no yarinaoshi',
  'valkyrie drive: mermaid', 'valkyrie drive -mermaid-',
  'interspecies reviewers', 'ishuzoku reviewers',
  'joshiochi! 2-kai kara onnanoko ga... futtekita!?',
  'avn awards', 'xbiz awards', 'dating naked', 'dating naked uk',
  'in the morning of la petite mort', 'erotic ghost story iii',
  'palang tod', 'a serbian film', 'taimanin asagi',
  'testament of sister new devil', 'shinmai maou no testament',
  'ikusa otome valkyrie', 'ladies versus butlers',
  'the testament of sister new devil',
]);

const TITLE_CONTAINS_BLOCKED  = ['hentai', 'pornograph', 'joshiochi', 'taimanin', 'eroge!'];
const BLOCKED_GENRES_SET       = new Set(['hentai', 'pornography', 'adult']);
const SYNOPSIS_PHRASES_BLOCKED = ['hentai', 'pornograph', 'sexually explicit', 'hardcore sex', 'softcore porn', 'av idol', ' jav '];
const BLOCKED_RATINGS_SET      = new Set(['NC-17', 'XXX', 'X-Rated', 'AO']);

function isAdultContent(record) {
  if (!record) return false;
  const title    = (record.title || '').toLowerCase().trim();
  const genres   = (record.genre || '').toLowerCase().split(',').map(g => g.trim());
  const synopsis = (record.synopsis || '').toLowerCase();
  const rating   = (record.ageRating || '').trim();

  if (BLOCKED_EXACT_TITLES.has(title)) return true;
  if (TITLE_CONTAINS_BLOCKED.some(p => title.includes(p))) return true;
  if (genres.some(g => BLOCKED_GENRES_SET.has(g))) return true;
  if (BLOCKED_RATINGS_SET.has(rating)) return true;
  if (SYNOPSIS_PHRASES_BLOCKED.some(p => synopsis.includes(p))) return true;
  return false;
}

// ── Movie genre IDs ───────────────────────────────────────────────────────────
const MOVIE_GENRES = [
  { id: 28,    name: 'Action'       }, { id: 12,    name: 'Adventure'    },
  { id: 16,    name: 'Animation'    }, { id: 35,    name: 'Comedy'       },
  { id: 80,    name: 'Crime'        }, { id: 99,    name: 'Documentary'  },
  { id: 18,    name: 'Drama'        }, { id: 10751, name: 'Family'       },
  { id: 14,    name: 'Fantasy'      }, { id: 36,    name: 'History'      },
  { id: 27,    name: 'Horror'       }, { id: 10402, name: 'Music'        },
  { id: 9648,  name: 'Mystery'      }, { id: 10749, name: 'Romance'      },
  { id: 878,   name: 'Sci-Fi'       }, { id: 53,    name: 'Thriller'     },
  { id: 10752, name: 'War'          }, { id: 37,    name: 'Western'      },
];

const TV_GENRES = [
  { id: 10759, name: 'Action & Adventure' }, { id: 16,    name: 'Animation'       },
  { id: 35,    name: 'Comedy'             }, { id: 80,    name: 'Crime'            },
  { id: 99,    name: 'Documentary'        }, { id: 18,    name: 'Drama'            },
  { id: 10751, name: 'Family'             }, { id: 10762, name: 'Kids'             },
  { id: 9648,  name: 'Mystery'            }, { id: 10763, name: 'News'             },
  { id: 10764, name: 'Reality'            }, { id: 10765, name: 'Sci-Fi & Fantasy' },
  { id: 10768, name: 'War & Politics'     }, { id: 37,    name: 'Western'          },
];

// Language codes to pull international content
const LANGUAGES = [
  'en',  // English
  'ko',  // Korean (K-dramas, K-movies)
  'ja',  // Japanese (anime — filtered for non-adult)
  'es',  // Spanish
  'fr',  // French
  'hi',  // Hindi / Bollywood
  'zh',  // Chinese / Mandarin
  'pt',  // Portuguese / Brazilian
  'de',  // German
  'it',  // Italian
  'th',  // Thai
  'tr',  // Turkish
];

// Decades for discovery
const MOVIE_DECADES = [
  { from: '1920-01-01', to: '1949-12-31', label: '1920s-40s Classics'  },
  { from: '1950-01-01', to: '1969-12-31', label: '1950s-60s Classics'  },
  { from: '1970-01-01', to: '1979-12-31', label: '1970s Films'         },
  { from: '1980-01-01', to: '1989-12-31', label: '1980s Films'         },
  { from: '1990-01-01', to: '1999-12-31', label: '1990s Films'         },
  { from: '2000-01-01', to: '2009-12-31', label: '2000s Films'         },
  { from: '2010-01-01', to: '2019-12-31', label: '2010s Films'         },
  { from: '2020-01-01', to: '2029-12-31', label: '2020s Films'         },
];

const TV_DECADES = [
  { from: '1950-01-01', to: '1979-12-31', label: 'Classic TV (pre-1980)'  },
  { from: '1980-01-01', to: '1999-12-31', label: '1980s-90s TV'           },
  { from: '2000-01-01', to: '2009-12-31', label: '2000s TV'               },
  { from: '2010-01-01', to: '2019-12-31', label: '2010s TV'               },
  { from: '2020-01-01', to: '2029-12-31', label: '2020s TV'               },
];

// ── Build endpoint lists ──────────────────────────────────────────────────────

function buildMovieEndpoints() {
  const base = [
    { path: '/movie/popular',     params: { include_adult: false, region: 'US' },              label: 'Popular Movies'     },
    { path: '/movie/top_rated',   params: { include_adult: false, region: 'US' },              label: 'Top Rated Movies'   },
    { path: '/movie/now_playing', params: { include_adult: false, region: 'US' },              label: 'Now Playing Movies' },
    { path: '/movie/upcoming',    params: { include_adult: false, region: 'US' },              label: 'Upcoming Movies'    },
  ];

  // By genre
  const byGenre = MOVIE_GENRES.map(g => ({
    path: '/discover/movie',
    params: { include_adult: false, with_genres: g.id, sort_by: 'popularity.desc', 'vote_count.gte': MIN_VOTES_POPULAR },
    label: `Movies: ${g.name}`,
  }));

  // High quality by genre
  const qualityByGenre = MOVIE_GENRES.map(g => ({
    path: '/discover/movie',
    params: { include_adult: false, with_genres: g.id, sort_by: 'vote_average.desc', 'vote_count.gte': 500 },
    label: `Top Rated ${g.name} Movies`,
  }));

  // By decade
  const byDecade = MOVIE_DECADES.map(d => ({
    path: '/discover/movie',
    params: { include_adult: false, sort_by: 'vote_count.desc', 'primary_release_date.gte': d.from, 'primary_release_date.lte': d.to, 'vote_count.gte': MIN_VOTES_DISCOVER },
    label: d.label,
  }));

  // By language
  const byLanguage = LANGUAGES.filter(l => l !== 'en').map(l => ({
    path: '/discover/movie',
    params: { include_adult: false, with_original_language: l, sort_by: 'popularity.desc', 'vote_count.gte': MIN_VOTES_DISCOVER },
    label: `Movies: Language=${l}`,
  }));

  return [...base, ...byGenre, ...qualityByGenre, ...byDecade, ...byLanguage];
}

function buildTvEndpoints() {
  const base = [
    { path: '/tv/popular',      params: { include_adult: false }, label: 'Popular TV'      },
    { path: '/tv/top_rated',    params: { include_adult: false }, label: 'Top Rated TV'    },
    { path: '/tv/on_the_air',   params: { include_adult: false }, label: 'On The Air TV'   },
    { path: '/tv/airing_today', params: { include_adult: false }, label: 'Airing Today TV' },
  ];

  const byGenre = TV_GENRES.map(g => ({
    path: '/discover/tv',
    params: { include_adult: false, with_genres: g.id, sort_by: 'popularity.desc', 'vote_count.gte': MIN_VOTES_DISCOVER },
    label: `TV: ${g.name}`,
  }));

  const qualityByGenre = TV_GENRES.map(g => ({
    path: '/discover/tv',
    params: { include_adult: false, with_genres: g.id, sort_by: 'vote_average.desc', 'vote_count.gte': 100 },
    label: `Top Rated ${g.name} TV`,
  }));

  const byDecade = TV_DECADES.map(d => ({
    path: '/discover/tv',
    params: { include_adult: false, sort_by: 'vote_count.desc', 'first_air_date.gte': d.from, 'first_air_date.lte': d.to, 'vote_count.gte': MIN_VOTES_DISCOVER },
    label: d.label,
  }));

  const byLanguage = LANGUAGES.filter(l => l !== 'en').map(l => ({
    path: '/discover/tv',
    params: { include_adult: false, with_original_language: l, sort_by: 'popularity.desc', 'vote_count.gte': MIN_VOTES_DISCOVER },
    label: `TV: Language=${l}`,
  }));

  return [...base, ...byGenre, ...qualityByGenre, ...byDecade, ...byLanguage];
}

// ── TMDB API helper ───────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function tmdbFetch(endpoint, params = {}) {
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(String(k), String(v));

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });

  if (res.status === 429) {
    const retry = parseInt(res.headers.get('retry-after') || '10', 10);
    console.log(`\n  ⏳ Rate limited — waiting ${retry}s...`);
    await sleep(retry * 1000);
    return tmdbFetch(endpoint, params);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${endpoint}`);
  return res.json();
}

function formatGenres(genreIds, genreMap) {
  return (genreIds || []).map(id => genreMap[id]).filter(Boolean).join(', ') || null;
}
function formatCast(credits) {
  return (credits?.cast || []).slice(0, 8).map(p => p.name).join(', ') || null;
}
function formatCrew(credits, job) {
  return (credits?.crew || []).filter(p => p.job?.toLowerCase().includes(job)).slice(0, 3).map(p => p.name).join(', ') || null;
}
function formatCreator(details) {
  return (details.created_by || []).slice(0, 3).map(p => p.name).join(', ') || null;
}
function formatMovieRating(details) {
  const releases = details.release_dates?.results || [];
  const us = releases.find(r => r.iso_3166_1 === 'US');
  return us?.release_dates?.find(d => d.certification)?.certification || null;
}
function formatTvRating(details) {
  const ratings = details.content_ratings?.results || [];
  return ratings.find(r => r.iso_3166_1 === 'US')?.rating || null;
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

function loadCheckpoint(file) {
  if (!fs.existsSync(file)) return { completedLabels: [], seenIds: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { completedLabels: [], seenIds: [] }; }
}
function saveCheckpoint(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Record formatters ──────────────────────────────────────────────────────────

function formatMovieRecord(item, details, genreMap) {
  const title = details.title || item.title;
  if (!title) return null;
  // Skip if TMDB marks it as adult
  if (details.adult === true || item.adult === true) return null;

  const record = {
    sourceKey: `tmdb:movie:${item.id}`,
    mediaType: 'movie',
    title,
    year:      details.release_date || item.release_date,
    genre:     (details.genres || []).map(g => g.name).join(', ') || formatGenres(item.genre_ids, genreMap),
    director:  formatCrew(details.credits, 'director'),
    writers:   formatCrew(details.credits, 'writer') || formatCrew(details.credits, 'screenplay'),
    cast:      formatCast(details.credits),
    ageRating: formatMovieRating(details),
    overview:  details.overview || item.overview || null,
    synopsis:  details.overview || item.overview || null,
    posterUrl: details.poster_path ? `${POSTER_BASE}${details.poster_path}` : null,
    runtime:   details.runtime || null,
    tmdbId:    item.id,
  };

  if (isAdultContent(record)) return null;
  return record;
}

function formatTvRecord(item, details, genreMap) {
  const title = details.name || item.name;
  if (!title) return null;
  if (details.adult === true || item.adult === true) return null;

  const record = {
    sourceKey: `tmdb:tv:${item.id}`,
    mediaType: 'tv',
    title,
    year:      details.first_air_date || item.first_air_date,
    genre:     (details.genres || []).map(g => g.name).join(', ') || formatGenres(item.genre_ids, genreMap),
    creator:   formatCreator(details),
    writers:   formatCrew(details.credits, 'writer'),
    cast:      formatCast(details.credits),
    ageRating: formatTvRating(details),
    overview:  details.overview || item.overview || null,
    synopsis:  details.overview || item.overview || null,
    posterUrl: details.poster_path ? `${POSTER_BASE}${details.poster_path}` : null,
    seasons:   details.number_of_seasons || null,
    tmdbId:    item.id,
  };

  if (isAdultContent(record)) return null;
  return record;
}

// ── Core scraper ──────────────────────────────────────────────────────────────

async function scrape({ mediaType, endpoints, outFile, ckptFile, genreMap, formatRecord }) {
  const checkpoint   = RESUME ? loadCheckpoint(ckptFile) : { completedLabels: [], seenIds: [] };
  const seenIds      = new Set(checkpoint.seenIds || []);
  let   written      = seenIds.size;
  let   adultSkipped = 0;
  const stream       = fs.createWriteStream(outFile, { flags: RESUME ? 'a' : 'w' });
  const totalEp      = endpoints.length;
  let   epNum        = 0;

  for (const ep of endpoints) {
    epNum++;
    if (RESUME && checkpoint.completedLabels?.includes(ep.label)) {
      process.stdout.write(`\r  ⏭  ${epNum}/${totalEp} skipped: ${ep.label.slice(0,40)}`);
      continue;
    }

    console.log(`\n[${epNum}/${totalEp}] ${ep.label}`);

    let totalPages = PAGES;
    try {
      const first = await tmdbFetch(ep.path, { ...ep.params, page: 1 });
      totalPages = Math.min(PAGES, first.total_pages || PAGES);
      await sleep(DELAY_MS);

      const pageAdult = await processPage(first.results || [], seenIds, stream, genreMap, formatRecord, mediaType);
      written = seenIds.size - adultSkipped;
      adultSkipped += pageAdult;
    } catch (err) {
      console.error(`  ⚠️  Failed page 1: ${err.message}`);
      continue;
    }

    for (let page = 2; page <= totalPages; page++) {
      try {
        const data = await tmdbFetch(ep.path, { ...ep.params, page });
        const pageAdult = await processPage(data.results || [], seenIds, stream, genreMap, formatRecord, mediaType);
        adultSkipped += pageAdult;
        process.stdout.write(`\r  Page ${page}/${totalPages} — ${seenIds.size} seen, ${adultSkipped} adult filtered`);
        await sleep(DELAY_MS);
      } catch (err) {
        console.error(`\n  ⚠️  Error page ${page}: ${err.message}`);
        await sleep(2000);
      }
    }

    console.log('');
    checkpoint.completedLabels = [...(checkpoint.completedLabels || []), ep.label];
    checkpoint.seenIds = Array.from(seenIds);
    saveCheckpoint(ckptFile, checkpoint);
  }

  stream.end();
  return { written: seenIds.size, adultSkipped };
}

async function processPage(results, seenIds, stream, genreMap, formatRecord, mediaType) {
  let adultSkipped = 0;
  for (const item of results) {
    if (!item.id || seenIds.has(item.id)) continue;
    // Skip if TMDB flags as adult at list level
    if (item.adult === true) { seenIds.add(item.id); adultSkipped++; continue; }
    seenIds.add(item.id);

    try {
      const appendTo = mediaType === 'movie' ? 'credits,release_dates' : 'credits,content_ratings';
      const details  = await tmdbFetch(`/${mediaType === 'movie' ? 'movie' : 'tv'}/${item.id}`, {
        append_to_response: appendTo,
      });
      await sleep(DELAY_MS);

      if (details.adult === true) { adultSkipped++; continue; }

      const record = formatRecord(item, details, genreMap);
      if (!record) { adultSkipped++; continue; }
      stream.write(JSON.stringify(record) + '\n');
    } catch {
      // Skip silently
    }
  }
  return adultSkipped;
}

// ── Entry points ──────────────────────────────────────────────────────────────

async function scrapeMovies() {
  console.log('\n🎬 Building movie genre map...');
  const genreData = await tmdbFetch('/genre/movie/list');
  const genreMap  = {};
  for (const g of genreData.genres || []) genreMap[g.id] = g.name;

  const endpoints = buildMovieEndpoints();
  console.log(`   ${endpoints.length} endpoints × up to ${PAGES} pages`);

  const { written, adultSkipped } = await scrape({
    mediaType:    'movie',
    endpoints,
    outFile:      path.join(DATA_DIR, 'tmdb_movies.bulk.jsonl'),
    ckptFile:     path.join(DATA_DIR, 'tmdb_movies.tmdb.checkpoint.json'),
    genreMap,
    formatRecord: formatMovieRecord,
  });
  console.log(`\n✅ Movies — ${written} written, ${adultSkipped} adult filtered`);
}

async function scrapeTv() {
  console.log('\n📺 Building TV genre map...');
  const genreData = await tmdbFetch('/genre/tv/list');
  const genreMap  = {};
  for (const g of genreData.genres || []) genreMap[g.id] = g.name;

  const endpoints = buildTvEndpoints();
  console.log(`   ${endpoints.length} endpoints × up to ${PAGES} pages`);

  const { written, adultSkipped } = await scrape({
    mediaType:    'tv',
    endpoints,
    outFile:      path.join(DATA_DIR, 'tmdb_tv.bulk.jsonl'),
    ckptFile:     path.join(DATA_DIR, 'tmdb_tv.tmdb.checkpoint.json'),
    genreMap,
    formatRecord: formatTvRecord,
  });
  console.log(`\n✅ TV shows — ${written} written, ${adultSkipped} adult filtered`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!TMDB_API_KEY) {
    console.error('❌ TMDB_API_KEY not set in .env');
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const movieEps = buildMovieEndpoints().length;
  const tvEps    = buildTvEndpoints().length;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🦉 binge. TMDB Scraper (Adult-Free)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Type:      ${TYPE}`);
  console.log(`  Pages:     up to ${PAGES} per endpoint`);
  console.log(`  Resume:    ${RESUME}`);
  console.log(`  Endpoints: ${TYPE !== 'tv' ? movieEps + ' movie' : ''}${TYPE === 'both' ? ' + ' : ''}${TYPE !== 'movie' ? tvEps + ' TV' : ''}`);
  console.log(`  Filters:   include_adult=false + keyword filter + TMDB adult flag`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    if (TYPE === 'movie' || TYPE === 'both') await scrapeMovies();
    if (TYPE === 'tv'    || TYPE === 'both') await scrapeTv();
    console.log('\n🎉 Done! Restart the server to load new data.\n');
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  }
}

main();
