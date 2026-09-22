const express=require('express');
const {database}=require('./db');
const router=express.Router();
function normalizeEmbedId(kind, value) {
  if (value == null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  if (kind === 'tmdb' && /^\d+$/.test(normalized)) {
    return { kind: 'tmdb', value: normalized };
  }

  if (kind === 'imdb' && /^tt\d+$/i.test(normalized)) {
    return { kind: 'imdb', value: normalized.toLowerCase() };
  }

  return null;
}

function normalizeLookupTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripTrailingYearLabel(value, explicitYear) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const year = Number(explicitYear);
  const withKnownYear = Number.isFinite(year)
    ? raw
        .replace(new RegExp(`\\s*\\((?:${year})\\)\\s*$`), '')
        .replace(new RegExp(`\\s*-\\s*${year}\\s*$`), '')
        .trim()
    : raw;

  return withKnownYear
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/, '')
    .replace(/\s*-\s*(?:19|20)\d{2}\s*$/, '')
    .trim();
}

function buildLookupTitleVariants(title, year) {
  const variants = [];

  function addVariant(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    if (!variants.includes(normalized)) {
      variants.push(normalized);
    }
  }

  addVariant(title);
  addVariant(stripTrailingYearLabel(title, year));

  return variants;
}

function scoreImdbSuggestion(result, expected) {
  const resultTitle = normalizeLookupTitle(result?.l);
  const expectedTitle = normalizeLookupTitle(expected?.title);
  const resultTitleNoYear = normalizeLookupTitle(stripTrailingYearLabel(result?.l));
  const expectedTitleNoYear = normalizeLookupTitle(stripTrailingYearLabel(expected?.title, expected?.year));
  const resultYear = Number(result?.y);
  const expectedYear = Number(expected?.year);
  const qid = String(result?.qid || '').toLowerCase();
  const q = String(result?.q || '').toLowerCase();
  const isTvResult = qid.includes('tv') || q.includes('tv');
  const isMovieResult =
    qid === 'movie' ||
    qid === 'feature' ||
    q.includes('feature') ||
    q.includes('movie');
  const wantsTv = expected?.type === 'tv_show';
  const wantsMovie = !wantsTv;

  let score = 0;

  if (resultTitle && expectedTitle) {
    if (resultTitle === expectedTitle) {
      score += 120;
    } else if (resultTitle.includes(expectedTitle) || expectedTitle.includes(resultTitle)) {
      score += 70;
    }
  }

  if (resultTitleNoYear && expectedTitleNoYear) {
    if (resultTitleNoYear === expectedTitleNoYear) {
      score += 80;
    } else if (
      resultTitleNoYear.includes(expectedTitleNoYear) ||
      expectedTitleNoYear.includes(resultTitleNoYear)
    ) {
      score += 40;
    }
  }

  if (Number.isFinite(expectedYear) && Number.isFinite(resultYear)) {
    const diff = Math.abs(expectedYear - resultYear);
    if (diff === 0) score += 35;
    else if (diff === 1) score += 20;
    else if (diff === 2) score += 10;
    else score -= Math.min(diff * 4, 20);
  }

  if (wantsTv && isTvResult) score += 30;
  if (wantsMovie && isMovieResult) score += 30;
  if (wantsTv && isMovieResult) score -= 20;
  if (wantsMovie && isTvResult) score -= 20;

  if (qid === 'videoGame' || qid === 'podcastSeries') score -= 80;
  if (qid === 'video') score -= 15;

  if (Number.isFinite(Number(result?.rank))) {
    score += Math.max(20 - Math.floor(Number(result.rank) / 500), 0);
  }

  return score;
}

async function lookupImdbId(title, year, type) {
  let best = null;
  let bestScore = -Infinity;
  const titleVariants = buildLookupTitleVariants(title, year);

  for (const lookupTitle of titleVariants) {
    const firstChar = lookupTitle[0]?.toLowerCase();
    const bucket = /^[a-z0-9]$/.test(firstChar) ? firstChar : '_';
    const url = `https://v2.sg.media-imdb.com/suggestion/${bucket}/${encodeURIComponent(lookupTitle)}.json`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; binge-app/1.0)' },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      continue;
    }

    const data = await response.json();
    const candidates = Array.isArray(data?.d) ? data.d : [];

    for (const candidate of candidates) {
      const imdbId = normalizeEmbedId('imdb', candidate?.id);
      if (!imdbId) continue;

      const score = scoreImdbSuggestion(candidate, { title: lookupTitle, year, type });
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  if (!best || bestScore < 60) return null;

  return {
    kind: 'imdb',
    value: best.id.toLowerCase(),
    title: best.l || null,
    year: best.y ?? null,
  };
}

router.get('/embed-id', async (req, res) => {
  const { title, year, type, imdb, tmdb } = req.query;

  const directId =
    normalizeEmbedId('imdb', imdb) ||
    normalizeEmbedId('tmdb', tmdb);

  if (directId) {
    return res.json(directId);
  }

  if (!title) {
    return res.status(400).json({ error: 'title required' });
  }

  try {
    const imdbMatch = await lookupImdbId(title, year, type);
    if (imdbMatch) {
      return res.json(imdbMatch);
    }
  } catch (error) {
    console.warn('IMDb lookup failed:', error.message);
  }

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (TMDB_KEY) {
    try {
      const mediaType = type === 'tv_show' ? 'tv' : 'movie';
      const params = new URLSearchParams({
        api_key: TMDB_KEY,
        query: title,
        ...(year ? { first_air_date_year: year, year } : {}),
      });
      const url = `https://api.themoviedb.org/3/search/${mediaType}?${params}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json();
        const result = data.results?.[0];
        if (result?.id != null) {
          return res.json({
            kind: 'tmdb',
            value: String(result.id),
            title: result.title || result.name || null,
          });
        }
      }
    } catch (error) {
      console.warn('TMDB lookup failed:', error.message);
    }
  }

  return res.json({ kind: null, value: null });
});

router.get('/tmdb-id', async (req, res) => {
  const { title, year, type } = req.query;
  if (!title) return res.status(400).json({ error: 'title required' });

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) return res.json({ id: null });

  const mediaType = type === 'tv_show' ? 'tv' : 'movie';

  async function searchTmdb(query, extraParams = {}) {
    const params = new URLSearchParams({ api_key: TMDB_KEY, query, ...extraParams });
    const url = `https://api.themoviedb.org/3/search/${mediaType}?${params}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data.results?.[0] || null;
  }

  try {
    // Strategy 1: exact title + year
    let result = year ? await searchTmdb(title, { year, first_air_date_year: year }) : null;

    // Strategy 2: title without year
    if (!result) result = await searchTmdb(title);

    // Strategy 3: strip common subtitle separators (e.g. "Title: Subtitle" -> "Title")
    if (!result && title.includes(':')) {
      result = await searchTmdb(title.split(':')[0].trim());
    }

    // Strategy 4: strip parenthetical year from title e.g. "Show (2021)"
    if (!result && /\s*\(\d{4}\)\s*$/.test(title)) {
      result = await searchTmdb(title.replace(/\s*\(\d{4}\)\s*$/, '').trim());
    }

    // Strategy 5: try removing "Season X" or "Part X" suffixes
    if (!result && /\s+(season|part)\s+\d+/i.test(title)) {
      result = await searchTmdb(title.replace(/\s+(season|part)\s+\d+.*/i, '').trim());
    }

    // Strategy 6: for anime — try with "!" removed or common alt punctuation
    if (!result && /[!?]/.test(title)) {
      result = await searchTmdb(title.replace(/[!?]/g, '').trim());
    }

    if (!result) return res.json({ id: null });
    return res.json({ id: result.id, title: result.title || result.name });
  } catch (err) {
    return res.json({ id: null });
  }
});

// ─── TMDB show details (real season count) ───────────────────────────────────
router.get('/tmdb-show', async (req, res) => {
  const { tmdbId } = req.query;
  if (!tmdbId) return res.status(400).json({ error: 'tmdbId required' });

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) return res.status(503).json({ error: 'TMDB_API_KEY not set' });

  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return res.status(502).json({ error: 'TMDB error' });
    const data = await r.json();
    res.json({
      numberOfSeasons: data.number_of_seasons || null,
      numberOfEpisodes: data.number_of_episodes || null,
      status: data.status || null,
      name: data.name || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TMDB season episode count ────────────────────────────────────────────────
// In-memory cache for TMDB season data (avoids hammering API on repeat views)
const tmdbSeasonCache = new Map();
const TMDB_CACHE_TTL = 60 * 60 * 1000; // 1 hour

router.get('/tmdb-season', async (req, res) => {
  const { tmdbId, season } = req.query;
  if (!tmdbId || !season) return res.status(400).json({ error: 'tmdbId and season required' });

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (!TMDB_KEY) return res.status(503).json({ error: 'TMDB_API_KEY not set' });

  const cacheKey = `${tmdbId}:${season}`;
  const cached = tmdbSeasonCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TMDB_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ error: 'TMDB error' });
    const data = await r.json();
    const result = {
      season: data.season_number,
      episodeCount: data.episodes?.length || 0,
      episodes: (data.episodes || []).map(e => ({
        number: e.episode_number,
        name: e.name,
        airDate: e.air_date,
      })),
    };
    tmdbSeasonCache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get('/popular-titles',async(req,res)=>{
 const table=req.query.type==='tv'?'tv_shows':'movies';
 const {rows}=await database().query("SELECT data->>'title' AS title FROM binge.records WHERE collection=$1 AND data->>'poster_url' IS NOT NULL ORDER BY (data->>'year')::numeric DESC NULLS LAST LIMIT 80",[table]);
 res.json({titles:rows.map(r=>r.title)});
});
module.exports=router;
