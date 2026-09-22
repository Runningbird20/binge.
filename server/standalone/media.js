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
  const { title, year, type, imdb, tmdb, id } = req.query;

  const directId =
    normalizeEmbedId('imdb', imdb) ||
    normalizeEmbedId('tmdb', tmdb);

  if (directId) {
    const tmdbVal = directId.kind === 'tmdb' ? directId.value : null;
    const imdbVal = directId.kind === 'imdb' ? directId.value : null;
    return res.json({
      ...directId,
      embed_url: imdbVal ? `https://vidsrc.io/embed/${type === 'tv_show' ? 'tv' : 'movie'}?imdb=${imdbVal}` : null,
      embed_url_tmdb: tmdbVal ? `https://vidsrc.io/embed/${type === 'tv_show' ? 'tv' : 'movie'}?tmdb=${tmdbVal}` : null,
    });
  }

  // 1. Check by ID if provided
  if (id) {
    try {
      const table = type === 'tv_show' ? 'tv_shows' : 'movies';
      const { rows } = await database().query(
        `SELECT data->>'imdb_id' as imdb_id, data->>'source_key' as source_key, data->>'external_id' as external_id, data->>'title' as title, data->>'year' as year, data->>'embed_url' as embed_url, data->>'embed_url_tmdb' as embed_url_tmdb
         FROM binge.records
         WHERE collection = $1 AND (id = $2 OR data->>'source_key' = $3 OR data->>'imdb_id' = $2 OR data->>'external_id' = $2)
         LIMIT 1`,
        [table, String(id), `tmdb:${type === 'tv_show' ? 'tv' : 'movie'}:${id}`]
      );
      if (rows[0]) {
        const best = rows[0];
        const imdbId = normalizeEmbedId('imdb', best.imdb_id);
        if (imdbId) {
          return res.json({
            ...imdbId,
            title: best.title,
            year: best.year,
            embed_url: best.embed_url || `https://vidsrc.io/embed/${type === 'tv_show' ? 'tv' : 'movie'}?imdb=${imdbId.value}`,
            embed_url_tmdb: best.embed_url_tmdb,
          });
        }
        if (best.source_key && best.source_key.startsWith('tmdb:')) {
          const parts = best.source_key.split(':');
          if (parts[2]) {
            return res.json({
              kind: 'tmdb',
              value: parts[2],
              title: best.title,
              year: best.year,
              embed_url: best.embed_url,
              embed_url_tmdb: best.embed_url_tmdb || `https://vidsrc.io/embed/${type === 'tv_show' ? 'tv' : 'movie'}?tmdb=${parts[2]}`,
            });
          }
        }
        const extId = normalizeEmbedId('tmdb', best.external_id);
        if (extId) {
          return res.json({
            ...extId,
            title: best.title,
            year: best.year,
            embed_url: best.embed_url,
            embed_url_tmdb: best.embed_url_tmdb || `https://vidsrc.io/embed/${type === 'tv_show' ? 'tv' : 'movie'}?tmdb=${extId.value}`,
          });
        }
      }
    } catch (err) {
      console.warn('Database embed-id by ID lookup failed:', err.message);
    }
  }

  if (!title) {
    return res.status(400).json({ error: 'title required' });
  }

  // 2. Fast path: check local PostgreSQL database by title
  try {
    const table = type === 'tv_show' ? 'tv_shows' : 'movies';
    const { rows } = await database().query(
      `SELECT data->>'imdb_id' as imdb_id, data->>'source_key' as source_key, data->>'external_id' as external_id, data->>'title' as title, data->>'year' as year, data->>'embed_url' as embed_url, data->>'embed_url_tmdb' as embed_url_tmdb
       FROM binge.records
       WHERE collection = $1 AND (data->>'title' ILIKE $2 OR data->>'title' ILIKE $3)
       LIMIT 5`,
      [table, title.trim(), `%${title.trim()}%`]
    );
    if (rows.length > 0) {
      const best = rows.find(r => year && String(r.year) === String(year)) || rows[0];
      const imdbId = normalizeEmbedId('imdb', best.imdb_id);
      if (imdbId) {
        return res.json({
          ...imdbId,
          title: best.title,
          year: best.year,
          embed_url: best.embed_url || `https://vidsrc.io/embed/${type === 'tv_show' ? 'tv' : 'movie'}?imdb=${imdbId.value}`,
          embed_url_tmdb: best.embed_url_tmdb,
        });
      }
      if (best.source_key && best.source_key.startsWith('tmdb:')) {
        const parts = best.source_key.split(':');
        if (parts[2]) {
          return res.json({
            kind: 'tmdb',
            value: parts[2],
            title: best.title,
            year: best.year,
            embed_url: best.embed_url,
            embed_url_tmdb: best.embed_url_tmdb || `https://vidsrc.io/embed/${type === 'tv_show' ? 'tv' : 'movie'}?tmdb=${parts[2]}`,
          });
        }
      }
      const extId = normalizeEmbedId('tmdb', best.external_id);
      if (extId) {
        return res.json({
          ...extId,
          title: best.title,
          year: best.year,
          embed_url: best.embed_url,
          embed_url_tmdb: best.embed_url_tmdb || `https://vidsrc.io/embed/${type === 'tv_show' ? 'tv' : 'movie'}?tmdb=${extId.value}`,
        });
      }
    }
  } catch (err) {
    console.warn('Database embed-id lookup failed:', err.message);
  }

  // 3. IMDb lookup
  try {
    const imdbMatch = await lookupImdbId(title, year, type);
    if (imdbMatch) {
      return res.json({
        ...imdbMatch,
        embed_url: `https://vidsrc.io/embed/${type === 'tv_show' ? 'tv' : 'movie'}?imdb=${imdbMatch.value}`,
      });
    }
  } catch (error) {
    console.warn('IMDb lookup failed:', error.message);
  }

  // 4. Live VidSrc video servers lookup
  try {
    const vidsrcEndpoint = type === 'tv_show' ? '/episodes/latest/page-1.json' : '/movies/latest/page-1.json';
    const hosts = ['https://vidsrc.io', 'https://vsembed.ru'];
    for (const host of hosts) {
      try {
        const vRes = await fetch(`${host}${vidsrcEndpoint}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(3000),
        });
        if (vRes.ok) {
          const vJson = await vRes.json();
          const items = vJson.result || [];
          const match = items.find(r => {
            const itemTitle = (r.title || r.show_title || '').toLowerCase();
            return itemTitle.includes(title.toLowerCase().trim());
          });
          if (match) {
            if (match.tmdb_id) {
              return res.json({
                kind: 'tmdb',
                value: String(match.tmdb_id),
                title: match.title || match.show_title,
                embed_url: match.embed_url,
                embed_url_tmdb: match.embed_url_tmdb,
              });
            }
            if (match.imdb_id) {
              return res.json({
                kind: 'imdb',
                value: String(match.imdb_id),
                title: match.title || match.show_title,
                embed_url: match.embed_url,
                embed_url_tmdb: match.embed_url_tmdb,
              });
            }
          }
        }
      } catch {}
    }
  } catch (error) {
    console.warn('VidSrc video server lookup failed:', error.message);
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
            embed_url_tmdb: `https://vidsrc.io/embed/${mediaType}?tmdb=${result.id}`,
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


async function queryCatalogCollection(collection, queryParams) {
  const page = Math.max(1, parseInt(queryParams.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(queryParams.page_size, 10) || 48));
  const offset = (page - 1) * pageSize;
  const genre = queryParams.genre ? String(queryParams.genre).trim() : null;
  const search = queryParams.search ? String(queryParams.search).trim() : null;
  const sort = queryParams.sort || 'year-desc';

  const conditions = ["collection = $1"];
  const values = [collection];
  let paramIdx = 2;

  if (collection === 'movies' || collection === 'tv_shows') {
    conditions.push("data->>'poster_url' IS NOT NULL");
  }

  if (genre) {
    conditions.push(`data->>'genre' ILIKE $${paramIdx}`);
    values.push(`%${genre}%`);
    paramIdx++;
  }

  if (search) {
    if (collection === 'books') {
      conditions.push(`(data->>'title' ILIKE $${paramIdx} OR data->>'author' ILIKE $${paramIdx})`);
    } else {
      conditions.push(`(data->>'title' ILIKE $${paramIdx} OR data->>'genre' ILIKE $${paramIdx})`);
    }
    values.push(`%${search}%`);
    paramIdx++;
  }

  let orderBy = "(data->>'year')::numeric DESC NULLS LAST";
  if (sort === 'year-asc') {
    orderBy = "(data->>'year')::numeric ASC NULLS LAST";
  } else if (sort === 'title-asc') {
    orderBy = "data->>'title' ASC";
  } else if (sort === 'rating-desc') {
    orderBy = "(data->>'vote_average')::numeric DESC NULLS LAST, (data->>'year')::numeric DESC NULLS LAST";
  } else if (sort === 'popularity-desc') {
    orderBy = "(data->>'popularity')::numeric DESC NULLS LAST, (data->>'year')::numeric DESC NULLS LAST";
  }

  const whereClause = conditions.join(' AND ');
  const countQuery = `SELECT count(*)::integer AS total FROM binge.records WHERE ${whereClause}`;
  const dataQuery = `SELECT data FROM binge.records WHERE ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
  values.push(pageSize, offset);

  const [countRes, dataRes] = await Promise.all([
    database().query(countQuery, values.slice(0, paramIdx - 1)),
    database().query(dataQuery, values),
  ]);

  const total = countRes.rows[0]?.total || 0;
  const items = dataRes.rows.map(r => r.data);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  let facetsGenres = [];
  if (collection === 'movies') {
    facetsGenres = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'];
  } else if (collection === 'tv_shows') {
    facetsGenres = ['Action & Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Kids', 'Mystery', 'News', 'Reality', 'Sci-Fi & Fantasy', 'Soap', 'Talk', 'War & Politics', 'Western'];
  } else if (collection === 'books') {
    facetsGenres = ['Fiction', 'Fantasy', 'Science Fiction', 'Mystery', 'Thriller', 'Romance', 'Historical Fiction', 'Horror', 'Biography', 'History', 'Manga'];
  }

  return {
    items,
    total,
    total_items: total,
    page,
    pageSize,
    page_size: pageSize,
    totalPages,
    total_pages: totalPages,
    facets: { genres: facetsGenres }
  };
}

router.get('/movies', async (req, res) => {
  try {
    const result = await queryCatalogCollection('movies', req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tv-shows', async (req, res) => {
  try {
    const result = await queryCatalogCollection('tv_shows', req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/books', async (req, res) => {
  try {
    const result = await queryCatalogCollection('books', req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/popular-titles', async (req, res) => {
  const table = req.query.type === 'tv' ? 'tv_shows' : 'movies';
  const { rows } = await database().query(
    "SELECT data->>'title' AS title FROM binge.records WHERE collection=$1 AND data->>'poster_url' IS NOT NULL ORDER BY (data->>'year')::numeric DESC NULLS LAST LIMIT 80",
    [table]
  );
  res.json({ titles: rows.map(r => r.title) });
});

router.get('/movies/curated', async (req, res) => {
  try {
    const genres = ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Romance', 'Animation'];
    const rows = [];
    for (const g of genres) {
      const { rows: items } = await database().query(
        "SELECT data FROM binge.records WHERE collection='movies' AND data->>'genre' ILIKE $1 AND data->>'poster_url' IS NOT NULL ORDER BY (data->>'vote_average')::numeric DESC NULLS LAST LIMIT 20",
        [`%${g}%`]
      );
      if (items.length) {
        rows.push({
          id: g.toLowerCase(),
          title: `${g} Movies`,
          seeAll: `/movies?genre=${encodeURIComponent(g)}`,
          items: items.map(r => r.data)
        });
      }
    }
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tv-shows/curated', async (req, res) => {
  try {
    const genres = ['Drama', 'Comedy', 'Animation', 'Crime', 'Sci-Fi', 'Action', 'Documentary'];
    const rows = [];
    for (const g of genres) {
      const { rows: items } = await database().query(
        "SELECT data FROM binge.records WHERE collection='tv_shows' AND data->>'genre' ILIKE $1 AND data->>'poster_url' IS NOT NULL ORDER BY (data->>'vote_average')::numeric DESC NULLS LAST LIMIT 20",
        [`%${g}%`]
      );
      if (items.length) {
        rows.push({
          id: g.toLowerCase(),
          title: `${g} Shows`,
          seeAll: `/tv-shows?genre=${encodeURIComponent(g)}`,
          items: items.map(r => r.data)
        });
      }
    }
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/books/curated', async (req, res) => {
  try {
    const genres = ['Fiction', 'Fantasy', 'Science Fiction', 'Mystery', 'Romance', 'Thriller', 'Horror', 'History', 'Manga'];
    const rows = [];
    for (const g of genres) {
      const { rows: items } = await database().query(
        "SELECT data FROM binge.records WHERE collection='books' AND data->>'genre' ILIKE $1 AND (data->>'cover_url' IS NOT NULL OR data->>'poster_url' IS NOT NULL) LIMIT 20",
        [`%${g}%`]
      );
      if (items.length) {
        rows.push({
          id: g.toLowerCase().replace(/\s+/g, '-'),
          title: `${g} Books`,
          seeAll: `/books?genre=${encodeURIComponent(g)}`,
          items: items.map(r => r.data)
        });
      }
    }
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/movies/:id', async (req, res) => {
  const id = req.params.id;
  const { rows } = await database().query(
    "SELECT data FROM binge.records WHERE collection='movies' AND (id=$1 OR data->>'imdb_id'=$1 OR data->>'source_key'=$2 OR data->>'external_id'=$1)",
    [id, `tmdb:movie:${id}`]
  );
  if (rows[0]) {
    const data = { ...rows[0].data };
    const tmdbId = data.tmdb_id || (data.source_key?.startsWith('tmdb:movie:') ? data.source_key.split(':')[2] : null) || (/^\d+$/.test(data.id) ? data.id : null);
    const imdbId = data.imdb_id || (data.id?.startsWith('tt') ? data.id : null);
    if (!data.embed_url) {
      data.embed_url = imdbId ? `https://vidsrc.io/embed/movie?imdb=${imdbId}` : (tmdbId ? `https://vidsrc.io/embed/movie?tmdb=${tmdbId}` : null);
    }
    if (!data.embed_url_tmdb && tmdbId) {
      data.embed_url_tmdb = `https://vidsrc.io/embed/movie?tmdb=${tmdbId}`;
    }
    data.vidsrc_embed = data.embed_url || data.embed_url_tmdb;
    data.vidsrc_fast = tmdbId ? `https://vidsrc.to/embed/movie/${tmdbId}` : (imdbId ? `https://vidsrc.to/embed/movie/${imdbId}` : null);
    return res.json(data);
  }

  // Dynamic upstream fetch from TMDB if available
  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (TMDB_KEY) {
    try {
      let tmdbData = null;
      if (id.startsWith('tt')) {
        const findUrl = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`;
        const findRes = await fetch(findUrl, { signal: AbortSignal.timeout(5000) });
        if (findRes.ok) {
          const findJson = await findRes.json();
          const match = findJson.movie_results?.[0];
          if (match?.id) {
            const detailRes = await fetch(`https://api.themoviedb.org/3/movie/${match.id}?api_key=${TMDB_KEY}&append_to_response=credits`, { signal: AbortSignal.timeout(5000) });
            if (detailRes.ok) tmdbData = await detailRes.json();
          }
        }
      } else if (/^\d+$/.test(id)) {
        const detailRes = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&append_to_response=credits`, { signal: AbortSignal.timeout(5000) });
        if (detailRes.ok) tmdbData = await detailRes.json();
      }

      if (tmdbData?.id) {
        const record = {
          id: String(tmdbData.id),
          title: tmdbData.title || '',
          year: tmdbData.release_date ? parseInt(tmdbData.release_date.slice(0, 4), 10) : null,
          genre: (tmdbData.genres || []).map(g => g.name).join(', '),
          director: (tmdbData.credits?.crew || []).find(c => c.job === 'Director')?.name || null,
          writers: (tmdbData.credits?.crew || []).filter(c => ['Writer', 'Screenplay'].includes(c.job)).map(c => c.name).join(', ') || null,
          cast_members: (tmdbData.credits?.cast || []).slice(0, 10).map(c => c.name).join(', ') || null,
          age_rating: null,
          overview: tmdbData.overview || '',
          synopsis: tmdbData.overview || '',
          poster_url: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null,
          backdrop_url: tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}` : null,
          source_key: `tmdb:movie:${tmdbData.id}`,
          external_id: String(tmdbData.id),
          release_date: tmdbData.release_date || null,
          imdb_id: tmdbData.imdb_id || null,
          embed_url: tmdbData.imdb_id ? `https://vidsrc.io/embed/movie?imdb=${tmdbData.imdb_id}` : `https://vidsrc.io/embed/movie?tmdb=${tmdbData.id}`,
          embed_url_tmdb: `https://vidsrc.io/embed/movie?tmdb=${tmdbData.id}`,
          vidsrc_embed: `https://vidsrc.io/embed/movie?tmdb=${tmdbData.id}`,
          vidsrc_fast: `https://vidsrc.to/embed/movie/${tmdbData.id}`,
          vote_average: tmdbData.vote_average || 0,
          popularity: tmdbData.popularity || 0,
        };
        await database().query(
          "INSERT INTO binge.records(collection, id, data) VALUES('movies', $1, $2) ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data",
          [record.id, JSON.stringify(record)]
        );
        return res.json(record);
      }
    } catch (e) {
      console.warn('TMDB movie detail fetch failed:', e.message);
    }
  }

  return res.status(404).json({ error: 'Movie not found' });
});

router.get('/tv-shows/:id', async (req, res) => {
  const id = req.params.id;
  const { rows } = await database().query(
    "SELECT data FROM binge.records WHERE collection='tv_shows' AND (id=$1 OR data->>'imdb_id'=$1 OR data->>'source_key'=$2 OR data->>'external_id'=$1)",
    [id, `tmdb:tv:${id}`]
  );
  if (rows[0]) {
    const data = { ...rows[0].data };
    const tmdbId = data.tmdb_id || (data.source_key?.startsWith('tmdb:tv:') ? data.source_key.split(':')[2] : null) || (/^\d+$/.test(data.id) ? data.id : null);
    const imdbId = data.imdb_id || (data.id?.startsWith('tt') ? data.id : null);
    if (!data.embed_url) {
      data.embed_url = imdbId ? `https://vidsrc.io/embed/tv?imdb=${imdbId}&season=1&episode=1` : (tmdbId ? `https://vidsrc.io/embed/tv?tmdb=${tmdbId}&season=1&episode=1` : null);
    }
    if (!data.embed_url_tmdb && tmdbId) {
      data.embed_url_tmdb = `https://vidsrc.io/embed/tv?tmdb=${tmdbId}&season=1&episode=1`;
    }
    data.vidsrc_embed = data.embed_url || data.embed_url_tmdb;
    data.vidsrc_fast = tmdbId ? `https://vidsrc.to/embed/tv/${tmdbId}/1/1` : (imdbId ? `https://vidsrc.to/embed/tv/${imdbId}/1/1` : null);
    return res.json(data);
  }

  const TMDB_KEY = process.env.TMDB_API_KEY;
  if (TMDB_KEY) {
    try {
      let tmdbData = null;
      if (id.startsWith('tt')) {
        const findUrl = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_KEY}&external_source=imdb_id`;
        const findRes = await fetch(findUrl, { signal: AbortSignal.timeout(5000) });
        if (findRes.ok) {
          const findJson = await findRes.json();
          const match = findJson.tv_results?.[0];
          if (match?.id) {
            const detailRes = await fetch(`https://api.themoviedb.org/3/tv/${match.id}?api_key=${TMDB_KEY}&append_to_response=credits`, { signal: AbortSignal.timeout(5000) });
            if (detailRes.ok) tmdbData = await detailRes.json();
          }
        }
      } else if (/^\d+$/.test(id)) {
        const detailRes = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_KEY}&append_to_response=credits`, { signal: AbortSignal.timeout(5000) });
        if (detailRes.ok) tmdbData = await detailRes.json();
      }

      if (tmdbData?.id) {
        const record = {
          id: String(tmdbData.id),
          title: tmdbData.name || '',
          year: tmdbData.first_air_date ? parseInt(tmdbData.first_air_date.slice(0, 4), 10) : null,
          genre: (tmdbData.genres || []).map(g => g.name).join(', '),
          creator: (tmdbData.created_by || []).map(c => c.name).join(', ') || null,
          writers: null,
          cast_members: (tmdbData.credits?.cast || []).slice(0, 10).map(c => c.name).join(', ') || null,
          age_rating: null,
          overview: tmdbData.overview || '',
          synopsis: tmdbData.overview || '',
          poster_url: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null,
          backdrop_url: tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}` : null,
          source_key: `tmdb:tv:${tmdbData.id}`,
          external_id: String(tmdbData.id),
          seasons: tmdbData.number_of_seasons || 1,
          release_date: tmdbData.first_air_date || null,
          imdb_id: null,
          embed_url: `https://vidsrc.io/embed/tv?tmdb=${tmdbData.id}&season=1&episode=1`,
          embed_url_tmdb: `https://vidsrc.io/embed/tv?tmdb=${tmdbData.id}&season=1&episode=1`,
          vidsrc_embed: `https://vidsrc.io/embed/tv?tmdb=${tmdbData.id}&season=1&episode=1`,
          vidsrc_fast: `https://vidsrc.to/embed/tv/${tmdbData.id}/1/1`,
          vote_average: tmdbData.vote_average || 0,
          popularity: tmdbData.popularity || 0,
        };
        await database().query(
          "INSERT INTO binge.records(collection, id, data) VALUES('tv_shows', $1, $2) ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data",
          [record.id, JSON.stringify(record)]
        );
        return res.json(record);
      }
    } catch (e) {
      console.warn('TMDB tv show detail fetch failed:', e.message);
    }
  }

  return res.status(404).json({ error: 'TV show not found' });
});

router.get('/books/:id', async (req, res) => {
  const id = req.params.id;
  const { rows } = await database().query(
    "SELECT data FROM binge.records WHERE collection='books' AND (id=$1 OR data->>'source_key'=$2 OR data->>'source_key'=$3 OR data->>'source_key'=$4 OR data->>'source_key'=$1)",
    [id, `goodreads:${id}`, `openlibrary:${id}`, `mangadex:${id}`]
  );
  if (rows[0]) return res.json(rows[0].data);

  // Dynamic upstream fetch from Open Library
  try {
    const olRes = await fetch(`https://openlibrary.org/works/${id}.json`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (olRes.ok) {
      const olData = await olRes.json();
      const desc = typeof olData.description === 'string' ? olData.description : olData.description?.value || '';
      const coverId = Array.isArray(olData.covers) ? olData.covers.find(c => c > 0) : null;
      const record = {
        id: String(id),
        title: olData.title || '',
        author: '',
        year: null,
        genre: (olData.subjects || []).slice(0, 4).join(', ') || 'Fiction',
        description: desc,
        synopsis: desc,
        cover_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null,
        poster_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null,
        source_key: `openlibrary:${id}`,
      };
      await database().query(
        "INSERT INTO binge.records(collection, id, data) VALUES('books', $1, $2) ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data",
        [record.id, JSON.stringify(record)]
      );
      return res.json(record);
    }
  } catch (e) {
    console.warn('Open Library detail fetch failed:', e.message);
  }

  return res.status(404).json({ error: 'Book not found' });
});

// ── VidSrc Video Server Direct Endpoints ────────────────────────────────────

router.get('/vidsrc/latest', async (req, res) => {
  try {
    const [moviesRes, epsRes] = await Promise.allSettled([
      fetch('https://vidsrc.io/movies/latest/page-1.json', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) }).then(r => r.json()),
      fetch('https://vidsrc.io/episodes/latest/page-1.json', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) }).then(r => r.json()),
    ]);
    res.json({
      movies: moviesRes.status === 'fulfilled' ? (moviesRes.value?.result || []) : [],
      episodes: epsRes.status === 'fulfilled' ? (epsRes.value?.result || []) : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.all('/vidsrc/sync', async (req, res) => {
  try {
    const pages = Math.min(10, Math.max(1, parseInt(req.query.pages || req.body?.pages || '3', 10)));
    let movieCount = 0;
    let showCount = 0;

    for (let p = 1; p <= pages; p++) {
      try {
        const mRes = await fetch(`https://vidsrc.io/movies/latest/page-${p}.json`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
        if (mRes.ok) {
          const mJson = await mRes.json();
          const items = mJson.result || [];
          for (const item of items) {
            const id = String(item.tmdb_id || item.imdb_id);
            if (!id) continue;
            const record = {
              id,
              title: item.title,
              imdb_id: item.imdb_id || null,
              tmdb_id: item.tmdb_id ? String(item.tmdb_id) : null,
              source_key: item.tmdb_id ? `tmdb:movie:${item.tmdb_id}` : `vidsrc:movie:${item.imdb_id}`,
              embed_url: item.embed_url,
              embed_url_tmdb: item.embed_url_tmdb,
              quality: item.quality || '1080p',
              poster_url: item.tmdb_id ? `https://image.tmdb.org/t/p/w500/${item.tmdb_id}.jpg` : null,
            };
            await database().query(
              "INSERT INTO binge.records(collection, id, data) VALUES('movies', $1, $2) ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data",
              [id, JSON.stringify(record)]
            );
            movieCount++;
          }
        }
      } catch {}

      try {
        const eRes = await fetch(`https://vidsrc.io/episodes/latest/page-${p}.json`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
        if (eRes.ok) {
          const eJson = await eRes.json();
          const items = eJson.result || [];
          for (const item of items) {
            const id = String(item.tmdb_id || item.imdb_id);
            if (!id) continue;
            const record = {
              id,
              title: item.show_title,
              imdb_id: item.imdb_id || null,
              tmdb_id: item.tmdb_id ? String(item.tmdb_id) : null,
              source_key: item.tmdb_id ? `tmdb:tv:${item.tmdb_id}` : `vidsrc:tv:${item.imdb_id}`,
              seasons: parseInt(item.season, 10) || 1,
              embed_url: item.embed_url,
              embed_url_tmdb: item.embed_url_tmdb,
              quality: item.quality || '1080p',
            };
            await database().query(
              "INSERT INTO binge.records(collection, id, data) VALUES('tv_shows', $1, $2) ON CONFLICT (collection, id) DO UPDATE SET data = excluded.data",
              [id, JSON.stringify(record)]
            );
            showCount++;
          }
        }
      } catch {}
    }

    res.json({ success: true, moviesSynced: movieCount, showsSynced: showCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports=router;
