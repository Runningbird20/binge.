#!/usr/bin/env node
/**
 * tmdb_scraper.js — Imports movies and TV shows from TMDB into the binge. database.
 *
 * Usage:
 *   node tmdb_scraper.js --type movie --pages 20
 *   node tmdb_scraper.js --type tv --pages 20
 *   node tmdb_scraper.js --type both --pages 20
 *   node tmdb_scraper.js --type both --pages 50 --resume
 *
 * Output files (auto-loaded by the server on next restart):
 *   data/tmdb_movies.bulk.jsonl
 *   data/tmdb_tv.bulk.jsonl
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE    = 'https://api.themoviedb.org/3';
const POSTER_BASE  = 'https://image.tmdb.org/t/p/w500';
const DATA_DIR     = path.join(__dirname, 'data');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const hasFlag = (f) => args.includes(f);

const TYPE      = getArg('--type', 'both');   // movie | tv | both
const PAGES     = parseInt(getArg('--pages', '20'), 10);
const DELAY_MS  = parseInt(getArg('--delay', '250'), 10);
const RESUME    = hasFlag('--resume');

// TMDB endpoints to pull from — each returns paginated lists
const MOVIE_ENDPOINTS = [
  '/movie/popular',
  '/movie/top_rated',
  '/movie/now_playing',
  '/movie/upcoming',
];

const TV_ENDPOINTS = [
  '/tv/popular',
  '/tv/top_rated',
  '/tv/on_the_air',
  '/tv/airing_today',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tmdbFetch(endpoint, params = {}) {
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 429) {
    const retry = parseInt(res.headers.get('retry-after') || '5', 10);
    console.log(`  Rate limited — waiting ${retry}s...`);
    await sleep(retry * 1000);
    return tmdbFetch(endpoint, params);
  }

  if (!res.ok) throw new Error(`TMDB ${res.status} on ${endpoint}`);
  return res.json();
}

function formatGenres(genreIds, genreMap) {
  return genreIds
    .map(id => genreMap[id])
    .filter(Boolean)
    .join(', ') || null;
}

function formatCast(credits) {
  return (credits?.cast || [])
    .slice(0, 8)
    .map(p => p.name)
    .join(', ') || null;
}

function formatCrew(credits, job) {
  return (credits?.crew || [])
    .filter(p => p.job?.toLowerCase().includes(job))
    .slice(0, 3)
    .map(p => p.name)
    .join(', ') || null;
}

function formatCreator(details) {
  return (details.created_by || [])
    .slice(0, 3)
    .map(p => p.name)
    .join(', ') || null;
}

function formatRating(details) {
  // Movie certification
  const releases = details.release_dates?.results || [];
  const us = releases.find(r => r.iso_3166_1 === 'US');
  if (us) {
    const cert = us.release_dates?.find(d => d.certification)?.certification;
    if (cert) return cert;
  }
  // TV content rating
  const ratings = details.content_ratings?.results || [];
  const usTv = ratings.find(r => r.iso_3166_1 === 'US');
  return usTv?.rating || null;
}

// ── Checkpoint helpers ─────────────────────────────────────────────────────────

function loadCheckpoint(file) {
  if (!fs.existsSync(file)) return { completedEndpoints: [], seenIds: [] };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { completedEndpoints: [], seenIds: [] };
  }
}

function saveCheckpoint(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Movie scraper ──────────────────────────────────────────────────────────────

async function scrapeMovies() {
  const outFile    = path.join(DATA_DIR, 'tmdb_movies.bulk.jsonl');
  const ckptFile   = path.join(DATA_DIR, 'tmdb_movies.tmdb.checkpoint.json');

  // Load genre map
  console.log('\n📽  Fetching movie genres...');
  const genreData = await tmdbFetch('/genre/movie/list');
  const genreMap  = {};
  for (const g of genreData.genres || []) genreMap[g.id] = g.name;

  const checkpoint = RESUME ? loadCheckpoint(ckptFile) : { completedEndpoints: [], seenIds: [] };
  const seenIds    = new Set(checkpoint.seenIds || []);
  let totalWritten = seenIds.size;

  // Open file — append if resuming, overwrite if fresh
  const writeStream = fs.createWriteStream(outFile, { flags: RESUME ? 'a' : 'w' });

  for (const endpoint of MOVIE_ENDPOINTS) {
    if (RESUME && checkpoint.completedEndpoints?.includes(endpoint)) {
      console.log(`  Skipping ${endpoint} (already done)`);
      continue;
    }

    console.log(`\n🎬 Scraping ${endpoint} (${PAGES} pages)...`);

    for (let page = 1; page <= PAGES; page++) {
      try {
        const data = await tmdbFetch(endpoint, { page, region: 'US' });
        const results = data.results || [];

        for (const movie of results) {
          if (!movie.id || seenIds.has(movie.id)) continue;
          seenIds.add(movie.id);

          // Fetch full details with credits + certifications
          let details = {};
          try {
            details = await tmdbFetch(`/movie/${movie.id}`, {
              append_to_response: 'credits,release_dates',
            });
            await sleep(DELAY_MS);
          } catch (err) {
            console.log(`  Skipping movie ${movie.id}: ${err.message}`);
            continue;
          }

          const record = {
            sourceKey:  `tmdb:movie:${movie.id}`,
            mediaType:  'movie',
            title:      details.title || movie.title,
            year:       details.release_date || movie.release_date,
            genre:      formatGenres(details.genre_ids || (details.genres || []).map(g => g.id), genreMap)
                        || (details.genres || []).map(g => g.name).join(', ') || null,
            director:   formatCrew(details.credits, 'director'),
            writers:    formatCrew(details.credits, 'writer') || formatCrew(details.credits, 'screenplay'),
            cast:       formatCast(details.credits),
            ageRating:  formatRating(details),
            overview:   details.overview || movie.overview || null,
            synopsis:   details.overview || movie.overview || null,
            posterUrl:  details.poster_path ? `${POSTER_BASE}${details.poster_path}` : null,
            runtime:    details.runtime || null,
            tmdbId:     movie.id,
          };

          writeStream.write(JSON.stringify(record) + '\n');
          totalWritten++;
        }

        process.stdout.write(`\r  Page ${page}/${PAGES} — ${totalWritten} movies so far`);

        if (page < PAGES) await sleep(DELAY_MS);
      } catch (err) {
        console.error(`\n  Error on page ${page}: ${err.message}`);
        await sleep(2000);
      }
    }

    console.log('');
    checkpoint.completedEndpoints = [...(checkpoint.completedEndpoints || []), endpoint];
    checkpoint.seenIds = Array.from(seenIds);
    saveCheckpoint(ckptFile, checkpoint);
  }

  writeStream.end();
  console.log(`\n✅ Movies done — ${totalWritten} total written to ${outFile}`);
  return totalWritten;
}

// ── TV scraper ─────────────────────────────────────────────────────────────────

async function scrapeTv() {
  const outFile  = path.join(DATA_DIR, 'tmdb_tv.bulk.jsonl');
  const ckptFile = path.join(DATA_DIR, 'tmdb_tv.tmdb.checkpoint.json');

  console.log('\n📺 Fetching TV genres...');
  const genreData = await tmdbFetch('/genre/tv/list');
  const genreMap  = {};
  for (const g of genreData.genres || []) genreMap[g.id] = g.name;

  const checkpoint = RESUME ? loadCheckpoint(ckptFile) : { completedEndpoints: [], seenIds: [] };
  const seenIds    = new Set(checkpoint.seenIds || []);
  let totalWritten = seenIds.size;

  const writeStream = fs.createWriteStream(outFile, { flags: RESUME ? 'a' : 'w' });

  for (const endpoint of TV_ENDPOINTS) {
    if (RESUME && checkpoint.completedEndpoints?.includes(endpoint)) {
      console.log(`  Skipping ${endpoint} (already done)`);
      continue;
    }

    console.log(`\n📺 Scraping ${endpoint} (${PAGES} pages)...`);

    for (let page = 1; page <= PAGES; page++) {
      try {
        const data = await tmdbFetch(endpoint, { page });
        const results = data.results || [];

        for (const show of results) {
          if (!show.id || seenIds.has(show.id)) continue;
          seenIds.add(show.id);

          let details = {};
          try {
            details = await tmdbFetch(`/tv/${show.id}`, {
              append_to_response: 'credits,content_ratings',
            });
            await sleep(DELAY_MS);
          } catch (err) {
            console.log(`  Skipping show ${show.id}: ${err.message}`);
            continue;
          }

          const record = {
            sourceKey:  `tmdb:tv:${show.id}`,
            mediaType:  'tv',
            title:      details.name || show.name,
            year:       details.first_air_date || show.first_air_date,
            genre:      formatGenres(details.genre_ids || (details.genres || []).map(g => g.id), genreMap)
                        || (details.genres || []).map(g => g.name).join(', ') || null,
            creator:    formatCreator(details),
            writers:    formatCrew(details.credits, 'writer'),
            cast:       formatCast(details.credits),
            ageRating:  formatRating(details),
            overview:   details.overview || show.overview || null,
            synopsis:   details.overview || show.overview || null,
            posterUrl:  details.poster_path ? `${POSTER_BASE}${details.poster_path}` : null,
            seasons:    details.number_of_seasons || null,
            tmdbId:     show.id,
          };

          writeStream.write(JSON.stringify(record) + '\n');
          totalWritten++;
        }

        process.stdout.write(`\r  Page ${page}/${PAGES} — ${totalWritten} shows so far`);

        if (page < PAGES) await sleep(DELAY_MS);
      } catch (err) {
        console.error(`\n  Error on page ${page}: ${err.message}`);
        await sleep(2000);
      }
    }

    console.log('');
    checkpoint.completedEndpoints = [...(checkpoint.completedEndpoints || []), endpoint];
    checkpoint.seenIds = Array.from(seenIds);
    saveCheckpoint(ckptFile, checkpoint);
  }

  writeStream.end();
  console.log(`\n✅ TV shows done — ${totalWritten} total written to ${outFile}`);
  return totalWritten;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!TMDB_API_KEY) {
    console.error('❌ TMDB_API_KEY not found in .env file.');
    console.error('   Get a free key at https://www.themoviedb.org/settings/api');
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log(`🎬 TMDB Scraper`);
  console.log(`   Type:   ${TYPE}`);
  console.log(`   Pages:  ${PAGES} per endpoint`);
  console.log(`   Resume: ${RESUME}`);
  console.log(`   Delay:  ${DELAY_MS}ms between requests`);

  // Estimate: 4 endpoints × PAGES pages × ~20 results × 1 detail call each
  const estMovies = TYPE !== 'tv'  ? MOVIE_ENDPOINTS.length * PAGES * 20 : 0;
  const estTv     = TYPE !== 'movie' ? TV_ENDPOINTS.length * PAGES * 20 : 0;
  console.log(`\n   Estimated results: ~${estMovies + estTv} titles (deduplicated)`);
  console.log(`   Estimated time:    ~${Math.ceil((estMovies + estTv) * DELAY_MS / 60000)} minutes\n`);

  try {
    if (TYPE === 'movie' || TYPE === 'both') await scrapeMovies();
    if (TYPE === 'tv'    || TYPE === 'both') await scrapeTv();

    console.log('\n🎉 All done! Restart the server to load the new data.');
    console.log('   The server will automatically detect and import the new JSONL files.\n');
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
  }
}

main();
